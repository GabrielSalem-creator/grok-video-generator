import { NextResponse } from "next/server";
import { RateLimitError, runFullVideoGeneration } from "@/lib/video-api";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = body?.prompt as string | undefined;
    const aspectRatio = (body?.aspectRatio as string) || "16:9";

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const { id, videoUrl } = await runFullVideoGeneration({
      prompt: prompt.trim(),
      aspectRatio,
      logPrefix: "[faceai]",
    });

    return NextResponse.json({ id, videoUrl });
  } catch (error) {
    console.error("Error creating video:", error);
    if (error instanceof RateLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
