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

function safeFileName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
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

  const fileName = typeof body.fileName === "string" ? safeFileName(body.fileName) : "upload";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const sizeBytes = Number(body.sizeBytes);

  if (!fileName) {
    return jsonError("Upload failed: include a fileName.", 400);
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return jsonError("Upload failed: include a positive sizeBytes value.", 400);
  }

  if (sizeBytes > config.maxUploadBytes) {
    return jsonError("Upload failed: the selected file is too large.", 413, {
      maxUploadBytes: config.maxUploadBytes
    });
  }

  if (mimeType && !mimeType.startsWith("video/")) {
    return jsonError("Upload failed: only video files are supported.", 400);
  }

  let userId: string | undefined;
  try {
    userId = getOptionalUserId(body);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid userId.", 400);
  }

  const supabase = getSupabaseServerClient();
  const storagePath = `${userId || "anonymous"}/${crypto.randomUUID()}-${fileName}`;
  const { data, error } = await supabase.storage
    .from(config.bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl || !data?.token) {
    return jsonError("Upload failed while creating a signed upload URL.", 500, error?.message);
  }

  return NextResponse.json({
    storageBucket: config.bucket,
    storagePath,
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  });
}
