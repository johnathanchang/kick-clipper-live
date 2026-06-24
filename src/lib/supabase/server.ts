import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SupabaseServerConfig = {
  url?: string;
  serviceRoleKey?: string;
  bucket: string;
  maxUploadBytes: number;
  missing: string[];
};

export function getSupabaseServerConfig(): SupabaseServerConfig {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "videos";
  const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 524_288_000);
  const envVars = [
    { name: "SUPABASE_URL", value: url },
    { name: "SUPABASE_SERVICE_ROLE_KEY", value: serviceRoleKey }
  ];
  const missing = envVars.filter(({ value }) => !value).map(({ name }) => name);

  return {
    url,
    serviceRoleKey,
    bucket,
    maxUploadBytes: Number.isFinite(maxUploadBytes) ? maxUploadBytes : 524_288_000,
    missing
  };
}

export function getSupabaseServerClient(): SupabaseClient {
  const config = getSupabaseServerConfig();

  if (config.missing.length > 0 || !config.url || !config.serviceRoleKey) {
    throw new Error(`Missing Supabase env vars: ${config.missing.join(", ")}`);
  }

  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
