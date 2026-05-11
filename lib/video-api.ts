const BASE_URL = "https://veoaifree.com";
export const AJAX_ENDPOINT = `${BASE_URL}/wp-admin/admin-ajax.php`;
export const VIDEO_BASE = `${BASE_URL}/video/uploads`;

export const MAX_WAIT = 300;

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Same idea as Python: browser-like GET to HTML pages, then reuse cookies on AJAX POST. */
const HTML_FETCH_HEADERS: Record<string, string> = {
  "User-Agent": CHROME_UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  DNT: "1",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};

const NONCE_PATTERNS: RegExp[] = [
  /nonce["']?\s*[:=]\s*["']([^"']+)["']/,
  /"nonce":"([^"]+)"/,
  /nonce['"]([^'"]+)['"]/,
];

function getSetCookieList(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") {
    return h.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/** Merge Set-Cookie lines into a single Cookie request header (name=value pairs only). */
function mergeCookiesFromSetCookie(
  existingCookieHeader: string,
  setCookieHeaders: string[]
): string {
  const map = new Map<string, string>();
  for (const part of existingCookieHeader.split(";")) {
    const p = part.trim();
    if (!p.includes("=")) continue;
    const i = p.indexOf("=");
    map.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  for (const sc of setCookieHeaders) {
    const pair = sc.split(";")[0]?.trim();
    if (!pair?.includes("=")) continue;
    const i = pair.indexOf("=");
    map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function extractNonceAndCookies(): Promise<{
  nonce: string;
  cookieHeader: string;
}> {
  let cookieJar = "";
  const pages = ["veo-video-generator/", "grok-ai-video-generator/"] as const;

  for (const page of pages) {
    const url = `${BASE_URL}/${page}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          ...HTML_FETCH_HEADERS,
          ...(cookieJar ? { Cookie: cookieJar } : {}),
        },
        redirect: "follow",
        cache: "no-store",
      });
    } catch (e) {
      console.warn("[veo] GET failed:", page, e);
      continue;
    }

    if (!res.ok) {
      console.warn("[veo] GET", page, "status", res.status);
      continue;
    }

    const setCookies = getSetCookieList(res.headers);
    cookieJar = mergeCookiesFromSetCookie(cookieJar, setCookies);
    const text = await res.text();

    for (const pattern of NONCE_PATTERNS) {
      const m = text.match(pattern);
      if (m?.[1]) {
        return { nonce: m[1], cookieHeader: cookieJar };
      }
    }
  }

  throw new Error(
    "Could not extract API nonce from veoaifree.com (pages may have changed or the site is unreachable)."
  );
}

export function getAspectRatioValue(aspectRatio: string): string {
  const mapping: Record<string, string> = {
    "16:9": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "9:16": "VIDEO_ASPECT_RATIO_PORTRAIT",
    "1:1": "VIDEO_ASPECT_RATIO_SQUARE",
    "2:3": "VIDEO_ASPECT_RATIO_PORTRAIT",
    "3:2": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "4:3": "VIDEO_ASPECT_RATIO_LANDSCAPE",
    "3:4": "VIDEO_ASPECT_RATIO_PORTRAIT",
  };
  return mapping[aspectRatio] || "VIDEO_ASPECT_RATIO_LANDSCAPE";
}

/** Anti-403 AJAX POST: same fields as Python + origin / sec-fetch / session cookies. */
export async function submitPrompt(
  prompt: string,
  aspectRatio: string,
  nonce: string,
  cookieHeader: string
): Promise<string> {
  const formData = new URLSearchParams();
  formData.append("action", "veo_video_generator");
  formData.append("nonce", nonce);
  formData.append("prompt", prompt);
  formData.append("totalVariations", "1");
  formData.append("aspectRatio", getAspectRatioValue(aspectRatio));
  formData.append("actionType", "full-video-generate");

  const response = await fetch(AJAX_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest",
      referer: `${BASE_URL}/grok-ai-video-generator/`,
      origin: BASE_URL,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      priority: "u=1, i",
      "User-Agent": CHROME_UA,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Failed to submit prompt: ${response.status}${text ? ` — ${text.slice(0, 200)}` : ""}`
    );
  }

  const sceneData = (await response.text()).trim();
  if (!/^\d+$/.test(sceneData)) {
    throw new Error(`Unexpected response: ${sceneData.slice(0, 200)}`);
  }
  return sceneData;
}

export async function findVideoUrl(
  sceneData: string,
  startTime: number,
  logPrefix = "[video]"
): Promise<string> {
  for (let offset = 0; offset < MAX_WAIT; offset++) {
    const timestamp = startTime + offset;
    const url = `${VIDEO_BASE}/video_${sceneData}_${timestamp}.mp4`;

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
      });
      if (response.ok) {
        return url;
      }
    } catch {
      // continue
    } finally {
      clearTimeout(tid);
    }

    if (offset > 0 && offset % 30 === 0) {
      console.log(logPrefix, "Still searching… offset:", offset);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Video generation timed out. Please try again.");
}

/** Fresh nonce + cookies each run (no deploy / env nonce required). */
export async function runFullVideoGeneration(
  prompt: string,
  aspectRatio: string,
  logPrefix = "[video]"
): Promise<{ id: string; videoUrl: string }> {
  const { nonce, cookieHeader } = await extractNonceAndCookies();
  const sceneData = await submitPrompt(prompt.trim(), aspectRatio, nonce, cookieHeader);
  const startTs = Math.floor(Date.now() / 1000);
  const videoUrl = await findVideoUrl(sceneData, startTs, logPrefix);
  return { id: sceneData, videoUrl };
}
