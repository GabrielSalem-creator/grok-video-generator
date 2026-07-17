const API_URL = "https://api.apivondy.com/api/open/video/generate";

const MAX_RETRIES = 5;
const RETRY_DELAY_SEC = 2;
const REQUEST_TIMEOUT_MS = 30_000;

type ApiJson = Record<string, unknown>;

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15",
];

export class RateLimitError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function getProxyList(): string[] {
  const raw = process.env.PROXY_LIST ?? "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function getProxyForAttempt(attempt: number): string | undefined {
  const list = getProxyList();
  if (!list.length) return undefined;
  return list[(attempt - 1) % list.length];
}

function getSecChUaFromUa(ua: string): string {
  if (ua.includes("Firefox")) {
    return '"Firefox";v="135", "Not.A/Brand";v="8"';
  }
  if (ua.includes("Safari") && !ua.includes("Chrome")) {
    return '"Safari";v="18", "Not.A/Brand";v="8"';
  }
  const match = ua.match(/Chrome\/(\d+)/);
  const version = match?.[1] ?? "147";
  return `"Google Chrome";v="${version}", "Not.A/Brand";v="8", "Chromium";v="${version}"`;
}

function getPlatformFromUa(ua: string): string {
  if (ua.includes("Windows")) return '"Windows"';
  if (ua.includes("Mac")) return '"macOS"';
  if (ua.includes("Linux")) return '"Linux"';
  return '"Unknown"';
}

function getRandomDeviceId(): string {
  const hex = () => crypto.randomUUID().replace(/-/g, "");
  return [
    hex().slice(0, 16),
    hex().slice(0, 14),
    Date.now().toString(16),
    Math.floor(Math.random() * 0xffffffff).toString(16),
  ].join("-");
}

export function normalizeAspectRatio(aspectRatio: string): string {
  const map: Record<string, string> = {
    "16:9": "16:9",
    "9:16": "9:16",
    "1:1": "1:1",
    "4:3": "16:9",
    "3:4": "9:16",
  };
  return map[aspectRatio] ?? "16:9";
}

function isHttpUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("http://") || value.startsWith("https://"))
  );
}

function getNested(obj: ApiJson, path: string): unknown {
  let val: unknown = obj;
  for (const part of path.split(".")) {
    if (!val || typeof val !== "object") return undefined;
    val = (val as ApiJson)[part];
  }
  return val;
}

function extractVideoUrl(responseData: ApiJson): string | null {
  const keys = ["url", "resultUrl", "videoUrl", "data.url", "video_url"];

  for (const key of keys) {
    const val = key.includes(".")
      ? getNested(responseData, key)
      : responseData[key];
    if (isHttpUrl(val)) return val;
  }

  for (const value of Object.values(responseData)) {
    if (
      isHttpUrl(value) &&
      (value.includes(".mp4") || value.includes("video"))
    ) {
      return value;
    }
  }

  const data = responseData.data;
  if (data && typeof data === "object" && data !== null) {
    for (const value of Object.values(data as ApiJson)) {
      if (isHttpUrl(value)) return value;
    }
  }

  return null;
}

function extractId(responseData: ApiJson): string {
  for (const key of ["id", "taskId", "task_id", "jobId", "job_id"]) {
    const val = responseData[key];
    if (typeof val === "string" && val) return val;
  }
  return crypto.randomUUID();
}

async function fetchWithOptionalProxy(
  url: string,
  init: RequestInit,
  attempt: number
): Promise<Response> {
  const proxyUrl = getProxyForAttempt(attempt);
  if (proxyUrl) {
    try {
      const { ProxyAgent, fetch: undiciFetch } = await import("undici");
      const agent = new ProxyAgent(proxyUrl);
      return (await undiciFetch(url, {
        ...init,
        dispatcher: agent,
      })) as unknown as Response;
    } catch (e) {
      console.warn("[video] Proxy request failed, using direct fetch:", e);
    }
  }
  return fetch(url, init);
}

type SessionResult =
  | { ok: true; videoUrl: string; data: ApiJson }
  | { ok: false; rateLimited: boolean; error: string; data: ApiJson | null };

async function generateVideoWithSession(
  prompt: string,
  aspectRatio: string,
  attempt: number,
  logPrefix: string
): Promise<SessionResult> {
  const ua = pickRandom(USER_AGENTS);
  const deviceId = getRandomDeviceId();
  const proxyUrl = getProxyForAttempt(attempt);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": ua,
    "sec-ch-ua": getSecChUaFromUa(ua),
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": getPlatformFromUa(ua),
    "x-vondy-tier": "lite",
    "x-device-id": deviceId,
    Referer: "https://vondy.com/",
    Origin: "https://vondy.com",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
  };

  const payload = {
    prompt,
    duration: "5",
    aspectRatio,
    resolution: "720p",
    cameraFixed: false,
  };

  console.log(logPrefix, `Attempt ${attempt}`, {
    ua: ua.slice(0, 50) + "…",
    deviceId,
    proxy: proxyUrl ?? "none",
  });

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchWithOptionalProxy(
      API_URL,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal,
      },
      attempt
    );

    const text = await response.text();
    let data: ApiJson;
    try {
      data = JSON.parse(text) as ApiJson;
    } catch {
      data = { raw: text };
    }

    if (response.status === 429) {
      const errMsg =
        (typeof data.error === "string" && data.error) ||
        (typeof data.message === "string" && data.message) ||
        text.slice(0, 200);
      return {
        ok: false,
        rateLimited: true,
        error: `RATE_LIMITED: ${errMsg}`,
        data,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        rateLimited: false,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
        data,
      };
    }

    const videoUrl = extractVideoUrl(data);
    if (!videoUrl) {
      console.log(
        logPrefix,
        "No video URL in response:",
        JSON.stringify(data).slice(0, 500)
      );
      return {
        ok: false,
        rateLimited: false,
        error: "No video URL in response",
        data,
      };
    }

    return { ok: true, videoUrl, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      rateLimited: false,
      error: `Network error: ${msg}`,
      data: null,
    };
  } finally {
    clearTimeout(tid);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Vondy API with session rotation (matches generate_video.py). */
export async function runFullVideoGeneration(
  prompt: string,
  aspectRatio: string,
  _withAudio = false,
  logPrefix = "[video]"
): Promise<{ id: string; videoUrl: string }> {
  const ratio = normalizeAspectRatio(aspectRatio);
  let lastError = "Unknown error";

  console.log(logPrefix, "Generating:", prompt.slice(0, 80));

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await generateVideoWithSession(
      prompt.trim(),
      ratio,
      attempt,
      logPrefix
    );

    if (result.ok) {
      console.log(logPrefix, "Success on attempt", attempt);
      return {
        id: extractId(result.data),
        videoUrl: result.videoUrl,
      };
    }

    lastError = result.error;
    console.warn(logPrefix, "Attempt", attempt, "failed:", result.error);

    if (result.rateLimited && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_SEC * attempt * 1000;
      console.log(logPrefix, "Rate limited — retrying in", delay / 1000, "s…");
      await sleep(delay);
      continue;
    }

    if (!result.rateLimited) {
      break;
    }
  }

  if (lastError.includes("RATE_LIMITED")) {
    throw new RateLimitError(
      "Vondy rate limit reached after retries. Wait and try again, or set PROXY_LIST env for rotation."
    );
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${lastError}`);
}

// Back-compat alias used elsewhere
export const normalizeSize = normalizeAspectRatio;
