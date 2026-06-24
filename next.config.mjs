import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  outputFileTracingRoot: workspaceRoot,
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/export-plan": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/render": [
      "./node_modules/ffmpeg-static/ffmpeg",
      "./node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf"
    ]
  }
};

export default nextConfig;
