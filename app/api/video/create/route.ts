import { NextResponse } from "next/server";
import { runFullVideoGeneration } from "@/lib/video-api";

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

    const { id, videoUrl } = await runFullVideoGeneration(
      prompt.trim(),
      aspectRatio,
      "[v0]"
    );

    return NextResponse.json({ id, videoUrl });
  } catch (error) {
    console.error("Error creating video:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
