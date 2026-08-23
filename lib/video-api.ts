import crypto from "node:crypto";

const BACKEND = "https://shark-app-qm22v.ondigitalocean.app";
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const MAX_STATUS_POLLS = 90;
const POLL_INTERVAL_MS = 8_000;

const DEFAULT_TEXT_MODEL = "kling-v3-standard";
const DEFAULT_IMAGE_MODEL = "kling-v3-standard";
const MIN_CREDIT_COST = 0.0000000000001;

type ApiJson = Record<string, unknown>;

type WorkItem = {
  id?: string;
  status?: string;
  link?: string;
  error?: string | null;
};

const registeredDevices = new Set<string>();

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function generateDeviceId(): string {
  return "d_" + crypto.randomBytes(11).toString("hex");
}

async function upstreamCall(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: ApiJson }> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BACKEND + path, {
      method,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    clearTimeout(tid);
    const text = await res.text();
    let data: ApiJson;
    try {
      data = JSON.parse(text) as ApiJson;
    } catch {
      data = { error: "non-JSON upstream", raw: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    clearTimeout(tid);
    const isTimeout =
      e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      data: {
        error: isTimeout ? "Upstream timeout" : "Upstream unreachable",
      },
    };
  }
}

async function ensureDevice(deviceId: string) {
  if (registeredDevices.has(deviceId)) return;
  await upstreamCall("POST", "/V3/user/deviceId", {
    deviceId,
    platformName: "android",
  });
  await upstreamCall("POST", `/V3/user/${deviceId}/dailyCheckin/claim`, {});
  registeredDevices.add(deviceId);
}

function getUserWorks(data: ApiJson): WorkItem[] {
  const user = data.user as ApiJson | undefined;
  if (!user) return [];
  const recent = user.recentWorks;
  if (Array.isArray(recent)) return recent as WorkItem[];
  const history = user.history;
  if (Array.isArray(history)) return history as WorkItem[];
  return [];
}

async function uploadBase64Image(
  deviceId: string,
  bytes: Uint8Array
): Promise<string | null> {
  const base64Image = Buffer.from(bytes).toString("base64");
  if (base64Image.length > 10_000_000) return null;

  const res = await upstreamCall("POST", "/aiServices/upload-url", {
    deviceId,
    base64Image,
  });
  if (!res.ok) return null;

  const url = res.data.imageUrl ?? res.data.url;
  return typeof url === "string" && url ? url : null;
}

async function submitGeneration(
  deviceId: string,
  mode: "t2v" | "i2v",
  prompt: string,
  aspectRatio: string,
  imageInput?: string
): Promise<{ taskId: string } | { error: string }> {
  const payload: ApiJson = {
    deviceId,
    creditCost: MIN_CREDIT_COST,
    model: mode === "t2v" ? DEFAULT_TEXT_MODEL : DEFAULT_IMAGE_MODEL,
    prompt: prompt.replace(/[\x00-\x1F\x7F]/g, "").slice(0, 1000),
    aspect_ratio: aspectRatio,
    duration: 5,
    quality: "720p",
  };

  if (mode === "i2v") {
    if (!imageInput) return { error: "Image upload failed" };
    payload.image_input = imageInput;
  }

  const path =
    mode === "t2v"
      ? "/V3/aiServices/textToVideo"
      : "/V3/aiServices/imageToVideo";

  const res = await upstreamCall("POST", path, payload);
  if (!res.ok) {
    const err =
      typeof res.data.error === "string"
        ? res.data.error
        : `Generation failed (${res.status})`;
    return { error: err };
  }

  const taskId = res.data.videoQueryID;
  if (typeof taskId !== "string" || !taskId) {
    return { error: "No videoQueryID in upstream response" };
  }
  return { taskId };
}

async function pollUntilReady(
  deviceId: string,
  taskId: string,
  logPrefix: string
): Promise<string> {
  for (let poll = 1; poll <= MAX_STATUS_POLLS; poll++) {
    const res = await upstreamCall("GET", `/V3/user/${deviceId}`);
    if (!res.ok) {
      console.warn(logPrefix, `Poll ${poll}: user fetch failed`, res.status);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const works = getUserWorks(res.data);
    const work =
      works.find((w) => w.id === taskId) ??
      works.find((w) => w.status === "processing") ??
      works[0];

    if (work) {
      console.log(
        logPrefix,
        `Poll ${poll}: status=${work.status ?? "unknown"} id=${work.id ?? "n/a"}`
      );
      if (work.status === "ready" && work.link) return work.link;
      if (work.status === "error") {
        throw new Error(work.error || "Generation failed upstream");
      }
    } else {
      console.log(logPrefix, `Poll ${poll}: no works yet`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Status polling timed out");
}

export function normalizeAspectRatio(aspectRatio: string): string {
  const allowed = ["16:9", "9:16", "1:1", "4:3", "3:4"];
  return allowed.includes(aspectRatio) ? aspectRatio : "16:9";
}

export type ImageUploadInput = {
  bytes: Uint8Array;
  contentType: string;
  ext: string;
};

export type GenerateOptions = {
  prompt: string;
  aspectRatio?: string;
  image?: ImageUploadInput | null;
  logPrefix?: string;
};

/** Neon Studio backend — text-to-video / image-to-video via DigitalOcean API. */
export async function runFullVideoGeneration(
  promptOrOptions: string | GenerateOptions,
  aspectRatioArg = "16:9",
  _withAudio = false,
  logPrefixArg = "[neon]"
): Promise<{ id: string; videoUrl: string }> {
  const options: GenerateOptions =
    typeof promptOrOptions === "string"
      ? {
          prompt: promptOrOptions,
          aspectRatio: aspectRatioArg,
          logPrefix: logPrefixArg,
        }
      : promptOrOptions;

  const prompt = options.prompt.trim();
  const aspectRatio = normalizeAspectRatio(options.aspectRatio ?? "16:9");
  const logPrefix = options.logPrefix ?? "[neon]";
  const image = options.image ?? null;

  if (!prompt) throw new Error("Prompt is required");

  let lastError = "All attempts failed";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const deviceId = generateDeviceId();
    console.log(logPrefix, `Attempt ${attempt}/${MAX_ATTEMPTS}`, deviceId);

    try {
      await ensureDevice(deviceId);

      let imageInput: string | undefined;
      if (image) {
        console.log(logPrefix, "Uploading image…");
        const url = await uploadBase64Image(deviceId, image.bytes);
        if (!url) {
          lastError = "Image upload failed";
          continue;
        }
        imageInput = url;
      }

      const mode = imageInput ? "i2v" : "t2v";
      const submitted = await submitGeneration(
        deviceId,
        mode,
        prompt,
        aspectRatio,
        imageInput
      );

      if ("error" in submitted) {
        lastError = submitted.error;
        if (/rate|limit|quota|credit/i.test(lastError)) {
          await sleep(500 + Math.floor(Math.random() * 500));
        }
        continue;
      }

      console.log(logPrefix, "Task ID:", submitted.taskId);
      const videoUrl = await pollUntilReady(
        deviceId,
        submitted.taskId,
        logPrefix
      );
      return { id: submitted.taskId, videoUrl };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(logPrefix, "Attempt error:", lastError);
      continue;
    }
  }

  if (/rate|limit|quota|credit/i.test(lastError)) {
    throw new RateLimitError(lastError);
  }
  throw new Error(lastError);
}

export const normalizeSize = normalizeAspectRatio;

export function guessImageMeta(
  fileName: string,
  mimeType: string | null
): { contentType: string; ext: string } {
  const lower = fileName.toLowerCase();
  if (mimeType?.startsWith("image/")) {
    const ext =
      mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : mimeType.split("/")[1] || "jpg";
    return { contentType: mimeType, ext };
  }
  if (lower.endsWith(".png")) return { contentType: "image/png", ext: "png" };
  if (lower.endsWith(".webp")) return { contentType: "image/webp", ext: "webp" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  return { contentType: "image/jpeg", ext: "jpg" };
}
