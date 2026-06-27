import { NextResponse } from "next/server";

import {
  getSupabaseServerClient,
  getSupabaseServerConfig
} from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type JsonObject = Record<string, unknown>;

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function readJsonObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function getOptionalUserId(body: JsonObject) {
  const userId = typeof body.userId === "string" ? body.userId : undefined;

  if (!userId) {
    return undefined;
  }

  if (!UUID_PATTERN.test(userId)) {
    throw new Error("userId must be a UUID when provided.");
  }

  return userId;
}

export async function POST(request: Request) {
  const config = getSupabaseServerConfig();

  if (config.missing.length > 0) {
    return jsonError(
      "Uploads are not configured. Missing Supabase server environment variables.",
      503,
      { missing: config.missing }
    );
  }

  let body: JsonObject;
  try {
    body = readJsonObject(await request.json());
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }

  const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
  const originalFilename = typeof body.fileName === "string" ? body.fileName : null;
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : null;
  const sizeBytes = Number(body.sizeBytes);

  if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) {
    return jsonError("Upload completion failed: invalid storagePath.", 400);
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return jsonError("Upload completion failed: include a positive sizeBytes value.", 400);
  }

  let userId: string | undefined;
  try {
    userId = getOptionalUserId(body);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid userId.", 400);
  }

  const supabase = getSupabaseServerClient();
  const { data: exists, error: existsError } = await supabase.storage
    .from(config.bucket)
    .exists(storagePath);

  if (existsError || !exists) {
    return jsonError(
      "Upload completion failed: uploaded file was not found in storage.",
      400,
      existsError?.message
    );
  }

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      storage_bucket: config.bucket,
      storage_path: storagePath,
      original_filename: originalFilename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      status: "uploaded"
    })
    .select("id, status, storage_bucket, storage_path")
    .single();

  if (videoError || !video) {
    return jsonError("Upload saved, but video record creation failed.", 500, videoError?.message);
  }

  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .insert({
      video_id: video.id,
      user_id: userId,
      status: "uploaded"
    })
    .select("id, status")
    .single();

  if (jobError || !job) {
    return jsonError("Upload saved, but processing job creation failed.", 500, {
      videoId: video.id,
      message: jobError?.message
    });
  }

  return NextResponse.json(
    {
      videoId: video.id,
      jobId: job.id,
      status: job.status,
      storageBucket: video.storage_bucket,
      storagePath: video.storage_path
    },
    { status: 201 }
  );
}
