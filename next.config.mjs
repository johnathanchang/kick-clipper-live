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
      "./public/assets/fonts/**/*.ttf",
      "./public/assets/kick-logo.png",
      "./node_modules/emoji-datasource-apple/img/apple/64/**/*.png"
    ]
  }
};

export default nextConfig;
