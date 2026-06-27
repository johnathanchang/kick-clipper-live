import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parse as parseTwemoji } from "@twemoji/parser";
import { getPackagedFfmpegPath, resolveFfmpegPath } from "./ffmpegPath.js";

const PUBLIC_ASSETS_DIR = path.join(process.cwd(), "public", "assets");
const FONT_ASSETS_DIR = path.join(PUBLIC_ASSETS_DIR, "fonts");
const DEFAULT_APPLE_EMOJI_ASSET_DIR = path.join(
  process.cwd(),
  "node_modules",
  "emoji-datasource-apple",
  "img",
  "apple",
  "64",
);
const KICK_LOGO_PATH = path.join(PUBLIC_ASSETS_DIR, "kick-logo.png");
const BUNDLED_HEAVY_FONT_PATH = path.join(FONT_ASSETS_DIR, "Nunito-Black.ttf");
const CAPTION_FONT_PATH = BUNDLED_HEAVY_FONT_PATH;
const CAPTION_FONT_FAMILY = "Nunito Black";
const KICK_LINK_FONT_PATH = resolveComicSansMsFontPath();
const KICK_LINK_FONT_FAMILY = "Comic Sans MS";
const KICK_LINK_RENDER_FONT_RATIO = 0.3;
const EMOJI_SIZE_RATIO = 1.08;
const EMOJI_ADVANCE_RATIO = 1.16;
const EMOJI_LEADING_GAP_RATIO = EMOJI_ADVANCE_RATIO - EMOJI_SIZE_RATIO;
const DEFAULT_FFMPEG_PATH = getPackagedFfmpegPath();
const assetDataUriCache = new Map();
const rasterTextCache = new Map();
const rasterEmojiCache = new Map();

export class RenderValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "RenderValidationError";
    this.details = details;
  }
}

export function normalizeRenderPayload(input = {}) {
  const payload = input.exportPlan ?? input.renderPlan ?? input;
  const sourcePath = payload.sourcePath ?? input.sourcePath;
  const outputPath = payload.outputPath ?? input.outputPath ?? createRenderedStoragePath(sourcePath);
  const selectedCrop = payload.selectedCrop ?? payload.reelPlan?.selectedCrop ?? payload.reelPlan?.crop;
  const target = payload.reelPlan?.target ?? payload.target ?? { width: 1080, height: 1920 };
  const captionRect = payload.captionRect ?? payload.captionRenderPlan?.rect;
  const captionText = payload.captionRenderPlan?.text ?? payload.captionText ?? input.captionText;
  const captionStyle = payload.captionStyle ?? payload.captionRenderPlan?.style ?? input.captionStyle ?? {};

  if (!sourcePath) {
    throw new RenderValidationError("Render payload must include a sourcePath.");
  }

  if (!selectedCrop) {
    throw new RenderValidationError("Render payload must include selectedCrop or reelPlan.crop.");
  }

  if (!captionRect) {
    throw new RenderValidationError("Render payload must include captionRect or captionRenderPlan.rect.");
  }

  if (!captionText || typeof captionText !== "string") {
    throw new RenderValidationError("Render payload must include caption text.");
  }

  assertRect(selectedCrop, "selectedCrop");
  assertRect(captionRect, "captionRect");

  return {
    ...payload,
    videoId: payload.videoId ?? input.videoId,
    jobId: payload.jobId ?? input.jobId,
    sourcePath,
    outputPath,
    selectedCrop,
    target,
    captionRect,
    captionText,
    captionStyle,
    ffmpegPath: resolveFfmpegPath(input.ffmpegPath ?? payload.ffmpeg?.executable),
  };
}

export function buildFfmpegRenderArgs(payload, localInputPath, localOutputPath, options = {}) {
  const normalized = normalizeRenderPayload(payload);
  const captionMode = resolveCaptionMode(options);

  if (captionMode === "image-overlay") {
    if (!options.captionOverlayPath) {
      throw new RenderValidationError("captionOverlayPath is required for image-overlay caption rendering.");
    }

    return [
      "-y",
      "-i",
      localInputPath,
      "-i",
      options.captionOverlayPath,
      "-filter_complex",
      `[0:v]${buildCropScaleFilter(normalized.selectedCrop, normalized.target)}[base];[base][1:v]overlay=0:0[v]`,
      "-map",
      "[v]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      localOutputPath,
    ];
  }

  const filters = [buildCropScaleFilter(normalized.selectedCrop, normalized.target)];

  if (captionMode === "drawtext") {
    filters.push(
      buildCaptionFilter(normalized.captionText, normalized.captionRect, normalized.captionStyle),
    );
  }

  return [
    "-y",
    "-i",
    localInputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    localOutputPath,
  ];
}

export async function detectFfmpegRenderSupport(ffmpegPath = DEFAULT_FFMPEG_PATH) {
  await assertFfmpegAvailable(ffmpegPath);
  const [drawtextSupported, overlaySupported] = await Promise.all([
    ffmpegSupportsFilter(ffmpegPath, "drawtext"),
    ffmpegSupportsFilter(ffmpegPath, "overlay"),
  ]);

  return {
    drawtextSupported,
    overlaySupported,
    imageCaptionOverlaySupported: overlaySupported,
    captionBurnInSupported: drawtextSupported || overlaySupported,
  };
}

export function createRenderMode(renderSupport, ffmpegPath = DEFAULT_FFMPEG_PATH) {
  if (renderSupport?.imageCaptionOverlaySupported || renderSupport?.overlaySupported) {
    return {
      mode: "caption-image-overlay",
      captionMode: "image-overlay",
      burnCaptions: true,
      userStatus: "Captions will be burned into the MP4.",
      warnings: [],
      internalNote: "Kick Clipper is using a generated PNG text overlay with bundled fonts.",
    };
  }

  if (renderSupport?.drawtextSupported) {
    return {
      mode: "caption-burn-in",
      captionMode: "drawtext",
      burnCaptions: true,
      userStatus: "Captions will be burned into the MP4.",
      warnings: [],
      internalNote: `FFmpeg at '${ffmpegPath}' does not support overlay, so Kick Clipper is using drawtext as a fallback.`,
    };
  }

  return {
    mode: "caption-render-unavailable",
    captionMode: "none",
    burnCaptions: false,
    warnings: [createCaptionBurnInUnavailableMessage(ffmpegPath)],
  };
}

export async function ffmpegSupportsFilter(ffmpegPath = DEFAULT_FFMPEG_PATH, filterName) {
  const result = await runProcess(ffmpegPath, ["-hide_banner", "-filters"]);
  const filterPattern = new RegExp(`\\b${escapeRegExp(filterName)}\\b`);

  return `${result.stdout}\n${result.stderr}`
    .split("\n")
    .some((line) => filterPattern.test(line));
}

export function createCaptionBurnInUnavailableMessage(ffmpegPath = DEFAULT_FFMPEG_PATH) {
  return [
    "Caption burn-in is unavailable because this local FFmpeg build cannot draw or overlay captions.",
    `Install an FFmpeg build with drawtext or overlay support, then make sure '${ffmpegPath}' points to that build.`,
  ].join(" ");
}

export async function createCaptionOverlayPng(payload, outputPath) {
  const normalized = normalizeRenderPayload(payload);
  const pngBuffer = await createRenderOverlayPngBuffer(normalized);

  await sharp(pngBuffer).png().toFile(outputPath);

  return outputPath;
}

export async function createRenderOverlayPngBuffer(payload) {
  const normalized = normalizeRenderPayload(payload);
  const target = normalized.target;
  const kickBranding = normalizeKickBranding(normalized.kickBranding);
  const captionLayout = await createCaptionRasterLayout(normalized);
  const backgroundSvg = buildRenderOverlayBackgroundSvg(normalized, kickBranding, captionLayout);
  const composites = [
    {
      input: await sharp(Buffer.from(backgroundSvg)).png().toBuffer(),
      left: 0,
      top: 0,
    },
    ...(await createCaptionRasterComposites(captionLayout)),
  ];

  if (kickBranding.enabled) {
    composites.push(await createKickLinkRasterComposite(normalized, kickBranding));
  }

  return sharp({
    create: {
      width: target.width,
      height: target.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export function getRenderFontAssets() {
  return {
    caption: CAPTION_FONT_PATH,
    kickLink: KICK_LINK_FONT_PATH,
  };
}

export function buildJobStatusPatch(status, errorMessage) {
  if (!["processing", "complete", "failed"].includes(status)) {
    throw new RenderValidationError("Invalid render job status.", { status });
  }

  return {
    status,
    error_message: status === "failed" ? errorMessage || "Render failed." : null,
    started_at: status === "processing" ? new Date().toISOString() : undefined,
    completed_at: status === "complete" || status === "failed" ? new Date().toISOString() : undefined,
  };
}

export function buildCropScaleFilter(crop, target) {
  return [
    `crop=${Math.round(crop.width)}:${Math.round(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)}`,
    `scale=${Math.round(target.width)}:${Math.round(target.height)}`,
  ].join(",");
}

export function buildCaptionFilter(text, rect, style = {}) {
  const background = ["white", "black", "none"].includes(style.background) ? style.background : "white";
  const textColor = style.textColor ?? (background === "white" ? "black" : "white");
  const fontSize = Math.round(style.fontSize ?? 64);
  const parts = [
    `drawtext=text='${escapeDrawText(text)}'`,
    `x=${Math.round(rect.x)}+((${Math.round(rect.width)}-text_w)/2)`,
    `y=${Math.round(rect.y)}+((${Math.round(rect.height)}-text_h)/2)`,
    `fontcolor=${textColor}`,
    `fontsize=${fontSize}`,
    "line_spacing=8",
  ];

  if (background !== "none") {
    parts.push(
      "box=1",
      `boxcolor=${background === "white" ? "white@0.96" : "black@0.82"}`,
      "boxborderw=24",
    );
  } else {
    parts.push("borderw=4", "bordercolor=black@0.9");
  }

  return parts.join(":");
}

export function buildCaptionOverlaySvg(payload) {
  return buildRenderOverlaySvg(payload);
}

export function buildRenderOverlaySvg(payload) {
  const normalized = normalizeRenderPayload(payload);
  const kickBranding = normalizeKickBranding(normalized.kickBranding);
  const captionLayout = createApproximateCaptionLayout(normalized);

  return buildRenderOverlayBackgroundSvg(normalized, kickBranding, captionLayout);
}

function buildRenderOverlayBackgroundSvg(normalized, kickBranding, captionLayout) {
  const target = normalized.target;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${target.width}" height="${target.height}" viewBox="0 0 ${target.width} ${target.height}">`,
    `<defs><filter id="captionBubbleShadow" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="#000000" flood-opacity="0.12"/></filter></defs>`,
    `<rect width="100%" height="100%" fill="transparent" />`,
    buildCaptionBackgroundSvgLayer(captionLayout),
    kickBranding.enabled ? buildKickBrandingSvgLayer(normalized) : "",
    "</svg>",
  ].join("");
}

export function getKickBrandingRect(payload) {
  const normalized = normalizeRenderPayload(payload);
  const plannedRect = normalized.kickBrandingRect ?? normalized.kickBrandingOverlay?.rect;

  if (isUsableRect(plannedRect)) {
    return plannedRect;
  }

  const target = normalized.target;
  const barHeight = Math.round(target.height * 0.056);
  const preferredY = Math.round(target.height * 0.779);
  const captionBottom = normalized.captionRect.y + normalized.captionRect.height;
  const gap = Math.round(target.height * 0.018);
  const maxY = target.height - barHeight - Math.round(target.height * 0.045);
  const y = Math.min(Math.max(preferredY, captionBottom + gap), maxY);

  return {
    x: 0,
    y,
    width: target.width,
    height: barHeight,
  };
}

function isUsableRect(rect) {
  return rect
    && Number.isFinite(Number(rect.x))
    && Number.isFinite(Number(rect.y))
    && Number.isFinite(Number(rect.width))
    && Number.isFinite(Number(rect.height))
    && rect.width > 0
    && rect.height > 0;
}

function createApproximateCaptionLayout(normalized) {
  const rect = normalized.captionRect;
  const target = normalized.target;
  const style = normalizeCaptionStyle(normalized.captionStyle);
  const fontSize = Math.round(style.fontSize ?? 64);
  const edgeMargin = 48;
  const paddingX = Math.max(30, Math.round(fontSize * 0.46));
  const paddingY = Math.max(12, Math.round(fontSize * 0.18));
  const maxBoxWidth = Math.min(rect.width, target.width - 2 * edgeMargin);
  const textWrapWidth = Math.max(fontSize * 3, maxBoxWidth - 2 * paddingX);
  const lines = wrapCaptionText(normalized.captionText, textWrapWidth, fontSize);
  const lineHeight = Math.round(fontSize * 1.16);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const estimatedLineWidths = lines.map((line) => estimateTextWidth(line, fontSize));
  const textWidth = Math.min(textWrapWidth, Math.max(...estimatedLineWidths, 1));
  const boxWidth = Math.min(maxBoxWidth, textWidth + 2 * paddingX);
  const boxHeight = Math.min(target.height - 2 * edgeMargin, blockHeight + 2 * paddingY);
  const boxCenterX = rect.x + rect.width / 2;
  const boxX = Math.round(clamp(boxCenterX - boxWidth / 2, edgeMargin, target.width - edgeMargin - boxWidth));
  const boxY = Math.round(clamp(rect.y + (rect.height - boxHeight) / 2, edgeMargin, target.height - edgeMargin - boxHeight));
  const textRect = {
    x: boxX + paddingX,
    y: boxY + paddingY,
    width: boxWidth - 2 * paddingX,
    height: blockHeight,
  };

  return {
    normalized,
    style,
    lines,
    lineHeight,
    blockHeight,
    fontSize,
    textColor: svgColor(style.textColor),
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    textRect,
    blockY: boxY + paddingY,
    radius: Math.max(14, Math.round(fontSize * 0.28)),
  };
}

async function createCaptionRasterLayout(normalized) {
  const rect = normalized.captionRect;
  const target = normalized.target;
  const style = normalizeCaptionStyle(normalized.captionStyle);
  const fontSize = Math.round(style.fontSize ?? 64);
  const edgeMargin = 48;
  const paddingX = Math.max(30, Math.round(fontSize * 0.46));
  const paddingY = Math.max(12, Math.round(fontSize * 0.18));
  const maxBoxWidth = Math.min(rect.width, target.width - 2 * edgeMargin);
  const textWrapWidth = Math.max(fontSize * 3, maxBoxWidth - 2 * paddingX);
  logCaptionEmojiAssets(normalized.captionText);
  const lines = await wrapCaptionTextRaster(normalized.captionText, textWrapWidth, fontSize);
  const lineHeight = Math.round(fontSize * 1.16);
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const lineWidths = await Promise.all(lines.map((line) => measureInlineLineWidth(line, fontSize)));
  const textWidth = Math.min(textWrapWidth, Math.max(...lineWidths, 1));
  const boxWidth = Math.min(maxBoxWidth, textWidth + 2 * paddingX);
  const boxHeight = Math.min(target.height - 2 * edgeMargin, blockHeight + 2 * paddingY);
  const boxCenterX = rect.x + rect.width / 2;
  const boxX = Math.round(clamp(boxCenterX - boxWidth / 2, edgeMargin, target.width - edgeMargin - boxWidth));
  const boxY = Math.round(clamp(rect.y + (rect.height - boxHeight) / 2, edgeMargin, target.height - edgeMargin - boxHeight));

  return {
    normalized,
    style,
    lines,
    lineHeight,
    lineWidths,
    blockHeight,
    fontSize,
    textColor: svgColor(style.textColor),
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    textRect: {
      x: boxX + paddingX,
      y: boxY + paddingY,
      width: boxWidth - 2 * paddingX,
      height: blockHeight,
    },
    blockY: boxY + paddingY,
    radius: Math.max(14, Math.round(fontSize * 0.28)),
  };
}

async function createCaptionRasterComposites(layout) {
  const composites = [];

  for (const [index, line] of layout.lines.entries()) {
    const lineWidth = layout.lineWidths[index] ?? await measureInlineLineWidth(line, layout.fontSize);
    const lineTop = layout.blockY + index * layout.lineHeight;
    let cursorX = layout.textRect.x + (layout.textRect.width - lineWidth) / 2;

    if (layout.style.background === "none") {
      composites.push(...await createInlineLineComposites(line, {
        fontSize: layout.fontSize,
        color: "#000000",
        lineTop: lineTop + 4,
        lineHeight: layout.lineHeight,
        startX: cursorX,
        opacity: 0.9,
      }));
    }

    composites.push(...await createInlineLineComposites(line, {
      fontSize: layout.fontSize,
      color: layout.textColor,
      lineTop,
      lineHeight: layout.lineHeight,
      startX: cursorX,
    }));
  }

  return composites;
}

async function createInlineLineComposites(line, options) {
  const composites = [];
  let cursorX = options.startX;

  for (const token of tokenizeCaptionLine(line)) {
    if (token.type === "emoji") {
      const emojiSize = Math.round(options.fontSize * EMOJI_SIZE_RATIO);
      const emojiLayer = await renderEmojiTokenPng(token, emojiSize, options.opacity);
      const left = Math.round(cursorX + options.fontSize * EMOJI_LEADING_GAP_RATIO);
      const top = Math.round(options.lineTop + (options.lineHeight - emojiLayer.height) / 2 + options.fontSize * 0.02);

      composites.push({ input: emojiLayer.buffer, left, top });
      cursorX += options.fontSize * EMOJI_ADVANCE_RATIO;
      continue;
    }

    const textLayer = await renderTextRunPng({
      text: token.value,
      fontSize: options.fontSize,
      color: options.color,
      fontFamily: CAPTION_FONT_FAMILY,
      fontPath: CAPTION_FONT_PATH,
      opacity: options.opacity,
    });
    const top = Math.round(options.lineTop + (options.lineHeight - textLayer.height) / 2 - options.fontSize * 0.01);

    if (textLayer.width > 0) {
      composites.push({ input: textLayer.buffer, left: Math.round(cursorX), top });
    }
    cursorX += textLayer.width;
  }

  return composites;
}

async function createKickLinkRasterComposite(normalized, kickBranding) {
  const rect = getKickBrandingRect(normalized);
  const rightPadding = Math.round(rect.width * 0.065);
  const linkFontSize = Math.round(rect.height * KICK_LINK_RENDER_FONT_RATIO);
  const layer = await renderTextRunPng({
    text: kickBranding.link.toUpperCase(),
    fontSize: linkFontSize,
    color: "#ffffff",
    fontFamily: KICK_LINK_FONT_FAMILY,
    fontPath: KICK_LINK_FONT_PATH,
  });

  return {
    input: layer.buffer,
    left: Math.round(rect.x + rect.width - rightPadding - layer.width),
    top: Math.round(rect.y + (rect.height - layer.height) / 2),
  };
}

function resolveComicSansMsFontPath() {
  const candidates = [
    process.env.COMIC_SANS_MS_FONT_PATH,
    path.join(FONT_ASSETS_DIR, "Comic Sans MS Bold.ttf"),
    path.join(FONT_ASSETS_DIR, "Comic Sans MS.ttf"),
    "/System/Library/Fonts/Supplemental/Comic Sans MS Bold.ttf",
    "/System/Library/Fonts/Supplemental/Comic Sans MS.ttf",
    "/Library/Fonts/Comic Sans MS Bold.ttf",
    "/Library/Fonts/Comic Sans MS.ttf",
    "C:\\Windows\\Fonts\\comicbd.ttf",
    "C:\\Windows\\Fonts\\comic.ttf",
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) ?? BUNDLED_HEAVY_FONT_PATH;
}

function buildCaptionBackgroundSvgLayer(layout) {
  const style = layout.style;
  const backgroundColor = style.background === "black" ? "#050505" : "#ffffff";
  const backgroundOpacity = style.background === "black" ? "0.86" : "0.98";
  const background = style.background === "none"
    ? ""
    : `<rect x="${layout.boxX}" y="${layout.boxY}" width="${layout.boxWidth}" height="${layout.boxHeight}" rx="${layout.radius}" ry="${layout.radius}" fill="${backgroundColor}" opacity="${backgroundOpacity}" filter="url(#captionBubbleShadow)" />`;

  return background;
}

function buildKickBrandingSvgLayer(normalized) {
  const rect = getKickBrandingRect(normalized);
  const logoWidth = Math.round(rect.width * 0.22);
  const logoHeight = Math.round(rect.height * 0.68);
  const logoX = Math.round(rect.x + rect.width * 0.065);
  const logoY = Math.round(rect.y - logoHeight * 0.2);
  const logoDataUri = assetDataUri(KICK_LOGO_PATH, "image/png");

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#030303" opacity="0.94" />`,
    `<image href="${logoDataUri}" x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMidYMid slice" />`,
  ].join("");
}

export async function assertFfmpegAvailable(ffmpegPath = DEFAULT_FFMPEG_PATH) {
  try {
    await runProcess(ffmpegPath, ["-version"]);
  } catch (error) {
    throw new Error(
      `FFmpeg is required locally but was not found at '${ffmpegPath}'. Install FFmpeg and ensure it is on PATH.`,
      { cause: error },
    );
  }
}

export function runFfmpegRender(ffmpegPath, args) {
  return runProcess(ffmpegPath, args);
}

export function createRenderedStoragePath(sourcePath) {
  const source = sourcePath || "render.mp4";
  const withoutExtension = source.replace(/\.[a-z0-9]+$/i, "");

  return `${withoutExtension}-rendered-${Date.now()}.mp4`;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function assertRect(rect, label) {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (values.some((value) => !Number.isFinite(Number(value))) || rect.width <= 0 || rect.height <= 0) {
    throw new RenderValidationError(`${label} must include positive x, y, width, and height numbers.`, rect);
  }
}

function resolveCaptionMode(options) {
  if (options.captionMode) {
    return options.captionMode;
  }

  return options.burnCaptions === false ? "none" : "drawtext";
}

function normalizeCaptionStyle(style = {}) {
  const background = ["white", "black", "none"].includes(style.background) ? style.background : "white";

  return {
    ...style,
    background,
    textColor: style.textColor ?? (background === "white" ? "black" : "white"),
  };
}

function normalizeKickBranding(branding = {}) {
  return {
    enabled: branding.enabled !== false,
    link: normalizeKickLink(branding.link),
  };
}

function normalizeKickLink(value) {
  const trimmed = String(value || "kick.com/clavicular").trim();

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/g, "");
}

function wrapCaptionText(text, maxWidth, fontSize) {
  const words = String(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (currentLine && estimateTextWidth(nextLine, fontSize) > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines.slice(0, 4) : [""];
}

function estimateTextWidth(text, fontSize) {
  return tokenizeCaptionLine(text).reduce((width, token) => {
    if (token.type === "emoji") {
      return width + fontSize * EMOJI_ADVANCE_RATIO;
    }

    return width + Array.from(token.value).reduce((textWidth, char) => {
      if (char === "\uFE0F") return textWidth;
      if (/\s/.test(char)) return textWidth + fontSize * 0.34;
      if (/[A-Z0-9]/.test(char)) return textWidth + fontSize * 0.66;
      return textWidth + fontSize * 0.58;
    }, 0);
  }, 0);
}

async function wrapCaptionTextRaster(text, maxWidth, fontSize) {
  const words = String(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (currentLine && await measureInlineLineWidth(nextLine, fontSize) > maxWidth) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines.slice(0, 4) : [""];
}

async function measureInlineLineWidth(line, fontSize) {
  let width = 0;

  for (const token of tokenizeCaptionLine(line)) {
    if (token.type === "emoji") {
      width += fontSize * EMOJI_ADVANCE_RATIO;
      continue;
    }

    const layer = await renderTextRunPng({
      text: token.value,
      fontSize,
      color: "#050505",
      fontFamily: CAPTION_FONT_FAMILY,
      fontPath: CAPTION_FONT_PATH,
    });
    width += layer.width;
  }

  return width;
}

async function renderTextRunPng({
  text,
  fontSize,
  color,
  fontFamily,
  fontPath,
  opacity = 1,
}) {
  const normalizedText = preserveSpacesForPango(text);
  if (isInvisibleTextRun(normalizedText)) {
    return {
      buffer: await transparentPng(1, 1),
      width: 0,
      height: 1,
    };
  }
  const cacheKey = JSON.stringify({
    text: normalizedText,
    fontSize,
    color,
    fontFamily,
    fontPath,
    opacity,
  });

  if (rasterTextCache.has(cacheKey)) {
    return rasterTextCache.get(cacheKey);
  }

  if (!existsSync(fontPath)) {
    throw new RenderValidationError(`Render font is missing: ${path.relative(process.cwd(), fontPath)}`);
  }

  const foreground = opacity < 1 ? colorWithAlpha(color, opacity) : color;
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${foreground}">${escapePangoMarkup(normalizedText)}</span>`,
      font: `${fontFamily} ${fontSize}`,
      fontfile: fontPath,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  const layer = {
    buffer: data,
    width: info.width,
    height: info.height,
  };

  rasterTextCache.set(cacheKey, layer);
  return layer;
}

function isInvisibleTextRun(value) {
  return String(value).replace(/[\u00A0\u200D\uFE0E\uFE0F\s]/g, "").length === 0;
}

async function transparentPng(width, height) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).png().toBuffer();
}

async function renderEmojiTokenPng(token, size, opacity = 1) {
  const emoji = token.emoji;
  const cacheKey = `${emoji?.assetPath ?? token.value}:${size}:${opacity}`;

  if (rasterEmojiCache.has(cacheKey)) {
    return rasterEmojiCache.get(cacheKey);
  }

  let buffer;
  if (emoji?.assetExists) {
    buffer = await sharp(emoji.assetPath)
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer();
  } else {
    buffer = await createMissingEmojiPlaceholderPng(size);
  }

  if (opacity < 1) {
    buffer = await sharp(buffer)
      .ensureAlpha(opacity)
      .png()
      .toBuffer();
  }

  const layer = {
    buffer,
    width: size,
    height: size,
  };

  rasterEmojiCache.set(cacheKey, layer);
  return layer;
}

async function createMissingEmojiPlaceholderPng(size) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await renderTextRunPng({
          text: "□",
          fontSize: Math.round(size * 0.88),
          color: "#050505",
          fontFamily: CAPTION_FONT_FAMILY,
          fontPath: CAPTION_FONT_PATH,
        }).then((layer) => layer.buffer),
        left: Math.round(size * 0.06),
        top: Math.round(size * 0.02),
      },
    ])
    .png()
    .toBuffer();
}

function tokenizeCaptionLine(line) {
  const tokens = [];
  let cursor = 0;
  const emojis = parseCaptionEmojiTokens(line);

  for (const emoji of emojis) {
    if (emoji.indices[0] > cursor) {
      tokens.push({ type: "text", value: line.slice(cursor, emoji.indices[0]) });
    }

    tokens.push({ type: "emoji", value: emoji.text, emoji });
    cursor = emoji.indices[1];
  }

  if (cursor < line.length) {
    tokens.push({ type: "text", value: line.slice(cursor) });
  }

  return tokens.filter((token) => token.value);
}

function parseCaptionEmojiTokens(text) {
  return parseTwemoji(String(text)).map((emoji) => {
    const codepoints = codepointsFromText(emoji.text);
    const parserCodepoints = emojiParserCodepoints(emoji);
    const assetFilename = resolveAppleEmojiAssetFilename(codepoints, parserCodepoints);
    const assetPath = assetFilename ? path.join(getAppleEmojiAssetDir(), assetFilename) : null;

    return {
      ...emoji,
      assetFilename,
      assetPath,
      codepoints,
      assetExists: Boolean(assetPath && existsSync(assetPath)),
    };
  });
}

function getAppleEmojiAssetDir() {
  return process.env.APPLE_EMOJI_ASSET_DIR || DEFAULT_APPLE_EMOJI_ASSET_DIR;
}

function resolveAppleEmojiAssetFilename(...codepointCandidates) {
  for (const codepoints of uniqueCodepointCandidates(codepointCandidates)) {
    const filename = `${codepoints}.png`;
    if (existsSync(path.join(getAppleEmojiAssetDir(), filename))) {
      return filename;
    }
  }

  return codepointCandidates.find(Boolean) ? `${codepointCandidates.find(Boolean)}.png` : null;
}

function uniqueCodepointCandidates(codepointCandidates) {
  const candidates = [];

  for (const candidate of codepointCandidates) {
    const normalized = normalizeEmojiCodepoints(candidate);

    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }

    const textPresentation = stripEmojiVariationSelectors(normalized);
    if (textPresentation && !candidates.includes(textPresentation)) {
      candidates.push(textPresentation);
    }
  }

  return candidates;
}

function emojiParserCodepoints(emoji) {
  try {
    const url = new URL(emoji.url);
    const filename = path.basename(url.pathname);
    return /^[0-9a-f-]+\.svg$/i.test(filename)
      ? filename.replace(/\.svg$/i, "").toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function codepointsFromText(text) {
  return Array.from(text)
    .map((char) => char.codePointAt(0).toString(16))
    .join("-");
}

function normalizeEmojiCodepoints(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.png$/i, "")
    .replace(/\.svg$/i, "")
    .replace(/[^0-9a-f-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function stripEmojiVariationSelectors(codepoints) {
  return normalizeEmojiCodepoints(codepoints)
    .split("-")
    .filter((codepoint) => codepoint !== "fe0f" && codepoint !== "fe0e")
    .join("-");
}

function emojiUnicodeLabel(codepoints) {
  return codepoints
    .split("-")
    .filter(Boolean)
    .map((codepoint) => `U+${codepoint.toUpperCase()}`)
    .join(" ");
}

function logCaptionEmojiAssets(text) {
  for (const emoji of parseCaptionEmojiTokens(text)) {
    const lines = [
      `Found emoji ${emoji.text}`,
      `Unicode: ${emojiUnicodeLabel(emoji.codepoints)}`,
    ];

    if (emoji.assetExists) {
      lines.push(`Asset: ${path.relative(process.cwd(), emoji.assetPath)}`);
    } else {
      lines.push(`Asset lookup failed: ${emoji.assetFilename ?? emoji.codepoints}`);
    }

    console.info(lines.join("\n"));
  }
}

function svgColor(value) {
  if (value === "black") return "#050505";
  if (value === "white") return "#ffffff";
  return /^#[0-9a-f]{3,8}$/i.test(String(value)) ? value : "#ffffff";
}

function escapeDrawText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapePangoMarkup(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function preserveSpacesForPango(value) {
  return String(value).replaceAll(" ", "\u00A0");
}

function colorWithAlpha(color, opacity) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(color));
  if (!match) {
    return color;
  }

  const alpha = Math.round(clamp(opacity, 0, 1) * 255)
    .toString(16)
    .padStart(2, "0");

  return `#${match[1]}${alpha}`;
}

function assetDataUri(filePath, mimeType) {
  const cacheKey = `${mimeType}:${filePath}`;
  if (assetDataUriCache.has(cacheKey)) {
    return assetDataUriCache.get(cacheKey);
  }

  if (!existsSync(filePath)) {
    throw new RenderValidationError(`Render asset is missing: ${path.relative(process.cwd(), filePath)}`);
  }

  const encoded = readFileSync(filePath).toString("base64");
  const dataUri = `data:${mimeType};base64,${encoded}`;
  assetDataUriCache.set(cacheKey, dataUri);

  return dataUri;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}
