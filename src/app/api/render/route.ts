import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import {
  getSupabaseServerClient,
  getSupabaseServerConfig
} from "@/lib/supabase/server";
import {
  RenderValidationError,
  buildFfmpegRenderArgs,
  buildJobStatusPatch,
  createCaptionOverlayPng,
  createRenderMode,
  detectFfmpegRenderSupport,
  normalizeRenderPayload,
  runFfmpegRender
} from "@/server/render/ffmpegRenderer.js";

export const runtime = "nodejs";

function jsonError(message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

async function updateJobStatus(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  jobId: string | undefined,
  status: "processing" | "complete" | "failed",
  errorMessage?: string
) {
  if (!jobId) {
    return;
  }

  const patch = buildJobStatusPatch(status, errorMessage);
  const { data: job } = await supabase
    .from("processing_jobs")
    .update(patch)
    .eq("id", jobId)
    .select("video_id")
    .single();

  if (job?.video_id) {
    await supabase.from("videos").update({ status }).eq("id", job.video_id);
  }
}

async function resolveSourceFromJob(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  jobId: string
) {
  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .select("id, video_id")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    throw new RenderValidationError("Processing job not found.", jobError?.message);
  }

  const { data: video, error: videoError } = await supabase
    .from("videos")
    .select("id, storage_bucket, storage_path")
    .eq("id", job.video_id)
    .single();

  if (videoError || !video) {
    throw new RenderValidationError("Source video for processing job not found.", videoError?.message);
  }

  return {
    videoId: video.id,
    sourceBucket: video.storage_bucket,
    sourcePath: video.storage_path
  };
}

export async function POST(request: Request) {
  const config = getSupabaseServerConfig();

  if (config.missing.length > 0) {
    return jsonError(
      "Rendering is not configured. Missing Supabase server environment variables.",
      503,
      { missing: config.missing }
    );
  }

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be JSON.", 400);
  }

  const supabase = getSupabaseServerClient();
  const requestPlan = body.exportPlan ?? body.renderPlan ?? body;
  let normalized;
  let workDir: string | undefined;
  let renderMode;

  try {
    if (!requestPlan.sourcePath && requestPlan.jobId) {
      const source = await resolveSourceFromJob(supabase, requestPlan.jobId);
      requestPlan.videoId = requestPlan.videoId ?? source.videoId;
      requestPlan.sourcePath = source.sourcePath;
      requestPlan.sourceBucket = source.sourceBucket;
    }

    normalized = normalizeRenderPayload(requestPlan);
    await updateJobStatus(supabase, normalized.jobId, "processing");
    const renderSupport = await detectFfmpegRenderSupport(normalized.ffmpegPath);
    renderMode = createRenderMode(renderSupport, normalized.ffmpegPath);

    const sourceBucket = normalized.sourceBucket ?? config.bucket;
    const outputBucket = normalized.outputBucket ?? config.bucket;
    const { data: sourceBlob, error: downloadError } = await supabase.storage
      .from(sourceBucket)
      .download(normalized.sourcePath);

    if (downloadError || !sourceBlob) {
      throw new Error(`Could not download source video: ${downloadError?.message || "missing blob"}`);
    }

    workDir = await mkdtemp(path.join(tmpdir(), "kick-clipper-render-"));
    const inputPath = path.join(workDir, "source-video");
    const outputPath = path.join(workDir, "rendered.mp4");
    const captionOverlayPath = path.join(workDir, "caption-overlay.png");
    await writeFile(inputPath, Buffer.from(await sourceBlob.arrayBuffer()));

    if (!renderMode.burnCaptions) {
      throw new Error("Caption rendering is not available on this machine. Install FFmpeg with drawtext or overlay support.");
    }

    if (renderMode.captionMode === "image-overlay") {
      await createCaptionOverlayPng(normalized, captionOverlayPath);
    }

    const ffmpegArgs = buildFfmpegRenderArgs(normalized, inputPath, outputPath, {
      captionMode: renderMode.captionMode,
      captionOverlayPath,
    });
    await runFfmpegRender(normalized.ffmpegPath, ffmpegArgs);

    const renderedBuffer = await readFile(outputPath);
    const { error: uploadError } = await supabase.storage
      .from(outputBucket)
      .upload(normalized.outputPath, renderedBuffer, {
        contentType: "video/mp4",
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Rendered video upload failed: ${uploadError.message}`);
    }

    const { data: signedUrlData } = await supabase.storage
      .from(outputBucket)
      .createSignedUrl(normalized.outputPath, 60 * 60);

    await updateJobStatus(supabase, normalized.jobId, "complete");

    return NextResponse.json({
      status: "complete",
      videoId: normalized.videoId,
      jobId: normalized.jobId,
      outputBucket,
      outputPath: normalized.outputPath,
      signedUrl: signedUrlData?.signedUrl,
      renderMode: renderMode.mode,
      captionBurnIn: {
        enabled: renderMode.burnCaptions,
        method: renderMode.captionMode,
        message: renderMode.userStatus
      },
      kickBranding: {
        enabled: normalized.kickBranding?.enabled !== false,
        link: normalized.kickBranding?.link
      },
      warnings: [],
      ffmpegArgsPreview: ffmpegArgs.map((arg) =>
        arg === inputPath
          ? "<local-input>"
          : arg === outputPath
            ? "<local-output>"
            : arg === captionOverlayPath
              ? "<caption-overlay>"
              : arg
      )
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Render failed.";
    const jobId = normalized?.jobId ?? requestPlan?.jobId;

    try {
      await updateJobStatus(supabase, jobId, "failed", message);
    } catch {
      // Preserve the original render error for the API response.
    }

    if (error instanceof RenderValidationError) {
      return jsonError(message, 400, error.details);
    }

    return jsonError(message, message.includes("FFmpeg is required") ? 503 : 500);
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
