import { NextResponse } from "next/server";

import { createKickClipExportPlan } from "../../../video/index.js";

export const runtime = "nodejs";

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function readPositiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export async function POST(request: Request) {
  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }

  const source = body?.source;
  const sourceWidth = readPositiveNumber(source?.width, 1920);
  const sourceHeight = readPositiveNumber(source?.height, 1080);
  const captionText = typeof body?.captionText === "string" ? body.captionText : "";

  if (!captionText.trim()) {
    return jsonError("captionText is required to create an export plan.", 400);
  }

  try {
    const exportPlan = createKickClipExportPlan({
      source: { width: sourceWidth, height: sourceHeight },
      videoId: body?.videoId,
      jobId: body?.jobId,
      sourcePath: body?.sourcePath,
      outputPath: body?.outputPath,
      captionText,
      captionStyle: body?.captionStyle,
      kickBranding: body?.kickBranding,
      captionPosition: body?.captionPosition,
      customRect: body?.customRect,
      subjectDetections: body?.subjectDetections,
      faceBox: body?.faceBox,
      faceConfidence: body?.faceConfidence,
      headBox: body?.headBox,
      headConfidence: body?.headConfidence,
      avoidWatermark: body?.avoidWatermark !== false,
      watermarkCorner: body?.watermarkCorner,
      captionBox: body?.captionBox,
      ffmpegPath: body?.ffmpegPath,
    });

    return NextResponse.json({ exportPlan });
  } catch (error) {
    return jsonError(
      "Export plan could not be created.",
      400,
      error instanceof Error ? error.message : String(error),
    );
  }
}
