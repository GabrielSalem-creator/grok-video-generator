import { ProxyAgent, fetch as undiciFetch } from "undici";

const BASE_URL = "https://faceai.art/api/faceai/ai_video_generator";
const QUOTA_URL = "https://faceai.art/api/users/faceai-quota";
const PRESIGNED_URL = "https://faceai.art/api/r2_presigned_url";
const THEME_VERSION =
  "83EmcUoQTUv50LhNx0VrdcK8rcGexcP35FcZDcpgWsAXEyO4xqL5shCY6sFIWB2Q";

const MAX_PROXY_ATTEMPTS = 15;
const MAX_STATUS_POLLS = 120;
const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 30_000;

type ApiJson = Record<string, unknown>;

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

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateFingerprint(): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

function generateFp1(length = 88): string {
  const byteLen = Math.floor((length * 3) / 4);
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return Buffer.from(bytes).toString("base64");
}

function generateXGuide(length = 170): string {
  const byteLen = Math.floor((length * 3) / 4);
  const bytes = crypto.getRandomValues(new Uint8Array(byteLen));
  return Buffer.from(bytes).toString("base64");
}

function envProxyList(): string[] {
  return (process.env.PROXY_LIST ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

let cachedFreeProxies: (string | null)[] | null = null;

async function fetchFreeProxies(): Promise<(string | null)[]> {
  if (cachedFreeProxies) return cachedFreeProxies;

  const fromEnv = envProxyList();
  if (fromEnv.length) {
    cachedFreeProxies = fromEnv;
    return cachedFreeProxies;
  }

  const sources = [
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
    "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=https&timeout=5000&country=all&ssl=all&anonymity=all",
  ];

  const proxies: string[] = [];
  for (const url of sources) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(tid);
      if (!res.ok) continue;
      const text = await res.text();
      for (const line of text.split(/\r?\n/)) {
        const host = line.trim();
        if (host && host.includes(":")) {
          proxies.push(`http://${host}`);
        }
      }
    } catch {
      // ignore
    }
  }

  const unique = [...new Set(proxies)];
  cachedFreeProxies = unique.length ? unique : [null];
  console.log(
    "[faceai] Proxies ready:",
    unique.length ? `${unique.length} free proxies` : "direct only"
  );
  return cachedFreeProxies;
}

async function fetchViaProxy(
  url: string,
  init: RequestInit,
  proxyUrl: string | null
): Promise<Response> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    if (proxyUrl) {
      const agent = new ProxyAgent(proxyUrl);
      return (await undiciFetch(url, {
        ...init,
        dispatcher: agent,
        signal: controller.signal,
      })) as unknown as Response;
    }
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(tid);
  }
}

async function parseJson(res: Response): Promise<ApiJson> {
  const text = await res.text();
  try {
    return JSON.parse(text) as ApiJson;
  } catch {
    return { raw: text, httpStatus: res.status };
  }
}

type SessionTokens = {
  fingerprint: string;
  fp1: string;
  xGuide: string;
};

function guestHeaders(tokens: SessionTokens, withJson = false): Record<string, string> {
  return {
    accept: withJson ? "application/json, text/plain, */*" : "*/*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8,fr;q=0.7",
    ...(withJson ? { "content-type": "application/json" } : {}),
    fp: tokens.fingerprint,
    fp1: tokens.fp1,
    "x-fingerprint": tokens.fingerprint,
    "x-guest-id": tokens.fingerprint,
    "x-guide": tokens.xGuide,
    "theme-version": THEME_VERSION,
    "x-code": String(Date.now()),
    "user-language": "undefined",
  };
}

async function getQuota(tokens: SessionTokens, proxy: string | null) {
  const url = `${QUOTA_URL}?_t=${Date.now()}`;
  const res = await fetchViaProxy(
    url,
    { method: "GET", headers: guestHeaders(tokens), cache: "no-store" },
    proxy
  );
  return parseJson(res);
}

async function getPresignedUrl(
  contentType: string,
  ext: string,
  tokens: SessionTokens,
  proxy: string | null
) {
  const params = new URLSearchParams({
    content_type: contentType,
    ext,
    target: "temp",
  });
  const res = await fetchViaProxy(
    `${PRESIGNED_URL}?${params}`,
    { method: "GET", headers: guestHeaders(tokens), cache: "no-store" },
    proxy
  );
  return parseJson(res);
}

async function uploadImage(
  presignedUrl: string,
  imageBytes: Uint8Array,
  contentType: string,
  proxy: string | null
): Promise<boolean> {
  const tryPut = async (useProxy: string | null) => {
    const res = await fetchViaProxy(
      presignedUrl,
      {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: Buffer.from(imageBytes),
      },
      useProxy
    );
    return res.status === 200 || res.status === 204;
  };

  try {
    if (await tryPut(proxy)) return true;
  } catch {
    // fall through
  }
  try {
    return await tryPut(null);
  } catch {
    return false;
  }
}

async function createVideo(
  prompt: string,
  aspectRatio: string,
  tokens: SessionTokens,
  proxy: string | null,
  mode: "t2v" | "i2v",
  sourceImage: string
) {
  const res = await fetchViaProxy(
    `${BASE_URL}/create`,
    {
      method: "POST",
      headers: guestHeaders(tokens, true),
      body: JSON.stringify({
        generation_mode: mode,
        prompt,
        source_image: sourceImage,
        aspect_ratio: aspectRatio,
        task_type: "ai_video_generator",
      }),
      cache: "no-store",
    },
    proxy
  );
  return parseJson(res);
}

async function checkStatus(
  taskId: string,
  tokens: SessionTokens,
  proxy: string | null
) {
  const res = await fetchViaProxy(
    `${BASE_URL}/status`,
    {
      method: "POST",
      headers: guestHeaders(tokens, true),
      body: JSON.stringify({ task_id: taskId }),
      cache: "no-store",
    },
    proxy
  );
  return parseJson(res);
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

function getCode(data: ApiJson): number | null {
  return typeof data.code === "number" ? data.code : null;
}

function getData(data: ApiJson): ApiJson {
  const d = data.data;
  return d && typeof d === "object" && d !== null ? (d as ApiJson) : {};
}

async function uploadSourceImage(
  image: ImageUploadInput,
  tokens: SessionTokens,
  proxy: string | null,
  logPrefix: string
): Promise<string | null> {
  const presign = await getPresignedUrl(
    image.contentType,
    image.ext,
    tokens,
    proxy
  );
  if (getCode(presign) !== 100000) {
    console.warn(logPrefix, "Presign failed:", JSON.stringify(presign).slice(0, 300));
    return null;
  }
  const data = getData(presign);
  const presignedUrl = data.presigned_url;
  const fileUrl = data.file_url;
  if (typeof presignedUrl !== "string" || typeof fileUrl !== "string") {
    return null;
  }

  console.log(logPrefix, "Uploading image…");
  const ok = await uploadImage(presignedUrl, image.bytes, image.contentType, proxy);
  if (!ok) {
    console.warn(logPrefix, "Upload failed");
    return null;
  }

  try {
    const path = new URL(fileUrl).pathname;
    return path;
  } catch {
    return fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`;
  }
}

async function pollUntilReady(
  taskId: string,
  tokens: SessionTokens,
  proxy: string | null,
  logPrefix: string
): Promise<string> {
  for (let poll = 1; poll <= MAX_STATUS_POLLS; poll++) {
    try {
      const statusResp = await checkStatus(taskId, tokens, proxy);
      if (getCode(statusResp) !== 100000) {
        console.log(logPrefix, `Status ${poll} unexpected:`, JSON.stringify(statusResp).slice(0, 200));
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = getData(statusResp);
      const status = data.status;
      const progress = data.progress ?? 0;
      console.log(logPrefix, `Status ${poll}: status=${status} progress=${progress}%`);

      if (status === 3) {
        const videoUrl = data.result_video;
        if (typeof videoUrl === "string" && videoUrl) return videoUrl;
        throw new Error("Completed but no result_video");
      }
      if (status === 4) {
        throw new Error(`Generation failed: ${JSON.stringify(data).slice(0, 300)}`);
      }

      await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Generation failed")) throw e;
      if (e instanceof Error && e.message.includes("result_video")) throw e;
      console.warn(logPrefix, "Poll error:", e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
  throw new Error("Status polling timed out");
}

export type GenerateOptions = {
  prompt: string;
  aspectRatio?: string;
  image?: ImageUploadInput | null;
  logPrefix?: string;
};

/** FaceAI text-to-video / image-to-video with fingerprint + proxy rotation. */
export async function runFullVideoGeneration(
  promptOrOptions: string | GenerateOptions,
  aspectRatioArg = "16:9",
  _withAudio = false,
  logPrefixArg = "[faceai]"
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
  const logPrefix = options.logPrefix ?? "[faceai]";
  const image = options.image ?? null;

  const proxies = await fetchFreeProxies();
  let lastError = "All attempts failed";

  for (let attempt = 1; attempt <= MAX_PROXY_ATTEMPTS; attempt++) {
    const tokens: SessionTokens = {
      fingerprint: generateFingerprint(),
      fp1: generateFp1(),
      xGuide: generateXGuide(),
    };
    const proxy = proxies[(attempt - 1) % proxies.length] ?? null;
    console.log(
      logPrefix,
      `Attempt ${attempt}/${MAX_PROXY_ATTEMPTS}`,
      proxy ?? "direct"
    );

    try {
      try {
        const quota = await getQuota(tokens, proxy);
        const features = getData(quota).features as ApiJson | undefined;
        const videoFeature =
          features && typeof features === "object"
            ? (features.ai_video_generator as ApiJson | undefined)
            : undefined;
        const remaining = videoFeature?.remaining_count ?? "N/A";
        console.log(logPrefix, "Quota remaining:", remaining);
      } catch (e) {
        console.warn(logPrefix, "Quota check failed:", e);
      }

      let mode: "t2v" | "i2v" = "t2v";
      let sourceImage = "";

      if (image) {
        const path = await uploadSourceImage(image, tokens, proxy, logPrefix);
        if (!path) {
          lastError = "Image upload failed";
          continue;
        }
        sourceImage = path;
        mode = "i2v";
      }

      const createResp = await createVideo(
        prompt,
        aspectRatio,
        tokens,
        proxy,
        mode,
        sourceImage
      );
      console.log(logPrefix, "Create:", JSON.stringify(createResp).slice(0, 400));

      const code = getCode(createResp);
      if (code === 638) {
        lastError = "Anonymous IP limit (638)";
        console.warn(logPrefix, lastError, "— next proxy…");
        continue;
      }
      if (code !== 100000) {
        lastError = `Create failed code ${code}: ${JSON.stringify(createResp).slice(0, 200)}`;
        continue;
      }

      const taskId = getData(createResp).task_id;
      if (typeof taskId !== "string" || !taskId) {
        lastError = "No task_id in create response";
        continue;
      }

      console.log(logPrefix, "Task ID:", taskId);
      const videoUrl = await pollUntilReady(taskId, tokens, proxy, logPrefix);
      return { id: taskId, videoUrl };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.warn(logPrefix, "Attempt error:", lastError);
      continue;
    }
  }

  if (lastError.includes("638") || /limit|quota|rate/i.test(lastError)) {
    throw new RateLimitError(
      "FaceAI rate/IP limit hit. Set PROXY_LIST in .env.local or try again later."
    );
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
