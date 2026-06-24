import { NextResponse } from "next/server";

import {
  getSupabaseServerClient,
  getSupabaseServerConfig
} from "@/lib/supabase/server";

export const runtime = "nodejs";

const JOB_STATUSES = new Set(["uploaded", "processing", "complete", "failed"]);

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function assertSupabaseConfigured() {
  const config = getSupabaseServerConfig();

  if (config.missing.length > 0) {
    return jsonError(
      "Job status is not configured. Missing Supabase server environment variables.",
      503,
      { missing: config.missing }
    );
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const configError = assertSupabaseConfigured();
  if (configError) {
    return configError;
  }

  const { jobId } = await params;
  const supabase = getSupabaseServerClient();
  const { data: job, error } = await supabase
    .from("processing_jobs")
    .select("id, video_id, status, error_message, started_at, completed_at, created_at, updated_at")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return jsonError("Processing job not found.", 404);
  }

  return NextResponse.json({ job });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const configError = assertSupabaseConfigured();
  if (configError) {
    return configError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }

  if (!body || typeof body !== "object" || !("status" in body)) {
    return jsonError("Request body must include a status.", 400);
  }

  const status = (body as { status?: unknown }).status;
  if (typeof status !== "string" || !JOB_STATUSES.has(status)) {
    return jsonError("Invalid processing status.", 400, {
      allowed: Array.from(JOB_STATUSES)
    });
  }

  const errorMessage = (body as { error_message?: unknown }).error_message;
  if (errorMessage !== undefined && typeof errorMessage !== "string") {
    return jsonError("error_message must be a string when provided.", 400);
  }

  const now = new Date().toISOString();
  const patch = {
    status,
    error_message: status === "failed" ? errorMessage || "Processing failed." : null,
    started_at: status === "processing" ? now : undefined,
    completed_at: status === "complete" || status === "failed" ? now : undefined
  };

  const { jobId } = await params;
  const supabase = getSupabaseServerClient();
  const { data: job, error } = await supabase
    .from("processing_jobs")
    .update(patch)
    .eq("id", jobId)
    .select("id, video_id, status, error_message, started_at, completed_at, updated_at")
    .single();

  if (error || !job) {
    return jsonError("Processing job not found or could not be updated.", 404);
  }

  await supabase.from("videos").update({ status }).eq("id", job.video_id);

  return NextResponse.json({ job });
}
