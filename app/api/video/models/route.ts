import { NextResponse } from "next/server";
import { fetchModelsCatalog } from "@/lib/video-api";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  try {
    const catalog = await fetchModelsCatalog();
    return NextResponse.json(catalog, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("Error fetching models:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load models",
      },
      { status: 502 }
    );
  }
}
