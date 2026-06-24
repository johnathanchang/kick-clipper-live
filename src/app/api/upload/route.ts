import { NextResponse } from "next/server";

import {
  getSupabaseServerClient,
  getSupabaseServerConfig
} from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function safeFileName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function getOptionalUserId(request: Request, formData: FormData) {
  const headerUserId = request.headers.get("x-user-id");
  const formUserId = formData.get("user_id");
  const userId =
    headerUserId || (typeof formUserId === "string" ? formUserId : undefined);

  if (!userId) {
    return undefined;
  }

  if (!UUID_PATTERN.test(userId)) {
    throw new Error("user_id must be a UUID when provided.");
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Upload request must be multipart/form-data.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError("Upload failed: include a video file in the 'file' field.", 400);
  }

  if (file.size === 0) {
    return jsonError("Upload failed: the selected file is empty.", 400);
  }

  if (file.size > config.maxUploadBytes) {
    return jsonError("Upload failed: the selected file is too large.", 413, {
      maxUploadBytes: config.maxUploadBytes
    });
  }

  if (file.type && !file.type.startsWith("video/")) {
    return jsonError("Upload failed: only video files are supported.", 400);
  }

  let userId: string | undefined;
  try {
    userId = getOptionalUserId(request, formData);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid user_id.", 400);
  }

  const supabase = getSupabaseServerClient();
  const fileName = safeFileName(file.name || "upload") || "upload";
  const storagePath = `${userId || "anonymous"}/${crypto.randomUUID()}-${fileName}`;
  const fileBuffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(config.bucket)
    .upload(storagePath, fileBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });

  if (uploadError) {
    return jsonError("Upload failed while saving the file.", 500, uploadError.message);
  }

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      storage_bucket: config.bucket,
      storage_path: storagePath,
      original_filename: file.name || null,
      mime_type: file.type || null,
      size_bytes: file.size,
      status: "uploaded"
    })
    .select("id, status, storage_bucket, storage_path")
    .single();

  if (videoError || !video) {
    await supabase.storage.from(config.bucket).remove([storagePath]);
    return jsonError("Upload failed while creating the video record.", 500, videoError?.message);
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
