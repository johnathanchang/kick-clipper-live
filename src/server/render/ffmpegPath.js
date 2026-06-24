import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStaticPath from "ffmpeg-static";

const FFMPEG_COMMAND = "ffmpeg";

export function getPackagedFfmpegPath() {
  return ffmpegStaticPath || FFMPEG_COMMAND;
}

export function resolveFfmpegPath(candidate) {
  if (!candidate || candidate === FFMPEG_COMMAND) {
    return getPackagedFfmpegPath();
  }

  if (
    path.basename(candidate) === FFMPEG_COMMAND &&
    candidate.includes(`${path.sep}ffmpeg-static${path.sep}`) &&
    !existsSync(candidate)
  ) {
    return getPackagedFfmpegPath();
  }

  return candidate;
}

export function logResolvedFfmpegPath(context, ffmpegPath) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    console.info(`[kick-clipper] ${context} resolved FFmpeg path: ${ffmpegPath}`);
  }
}
