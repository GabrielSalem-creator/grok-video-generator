import { NextResponse } from "next/server";
import {
  guessImageMeta,
  RateLimitError,
  runFullVideoGeneration,
} from "@/lib/video-api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const promptRaw = formData.get("prompt") as string | null;
    const aspectRatio = (formData.get("aspectRatio") as string) || "16:9";
    const imageUrl = (formData.get("imageUrl") as string | null)?.trim() || "";
    const imageFile = formData.get("image");

    const prompt =
      promptRaw?.trim() ||
      "Smooth natural motion, cinematic lighting, subtle camera movement";

    let image:
      | { bytes: Uint8Array; contentType: string; ext: string }
      | null = null;

    if (imageFile instanceof File && imageFile.size > 0) {
      const buf = new Uint8Array(await imageFile.arrayBuffer());
      const meta = guessImageMeta(imageFile.name || "image.jpg", imageFile.type);
      image = { bytes: buf, ...meta };
    } else if (imageUrl) {
      const res = await fetch(imageUrl, { cache: "no-store" });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Failed to download image URL (${res.status})` },
          { status: 400 }
        );
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const contentType =
        res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      const meta = guessImageMeta(imageUrl.split("?")[0] || "image.jpg", contentType);
      image = { bytes: buf, ...meta };
    }

    const { id, videoUrl } = await runFullVideoGeneration({
      prompt,
      aspectRatio,
      image,
      logPrefix: "[faceai-i2v]",
    });

    return NextResponse.json({ id, videoUrl });
  } catch (error) {
    console.error("Error creating image-to-video:", error);
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
