import { NextResponse } from "next/server";
import { runFullVideoGeneration } from "@/lib/video-api";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const promptRaw = formData.get("prompt") as string | null;
    const aspectRatio = (formData.get("aspectRatio") as string) || "16:9";
    const prompt =
      promptRaw?.trim() ||
      "Smooth natural motion, cinematic lighting, subtle camera movement";

    const { id, videoUrl } = await runFullVideoGeneration(prompt, aspectRatio);

    return NextResponse.json({ id, videoUrl });
  } catch (error) {
    console.error("Error creating image-to-video:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
