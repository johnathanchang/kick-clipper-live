import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parse as parseTwemoji } from "@twemoji/parser";
import { getPackagedFfmpegPath, resolveFfmpegPath } from "./ffmpegPath.js";

const PUBLIC_ASSETS_DIR = path.join(process.cwd(), "public", "assets");
const DEFAULT_TWEMOJI_ASSET_DIR = path.join(
  process.cwd(),
  "node_modules",
  "@discordapp",
  "twemoji",
  "dist",
  "svg",
);
const KICK_LOGO_PATH = path.join(PUBLIC_ASSETS_DIR, "kick-logo.png");
const OVERLAY_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "next",
  "dist",
  "compiled",
  "@vercel",
  "og",
  "noto-sans-v27-latin-regular.ttf",
);
const OVERLAY_FONT_FAMILY = "KickClipperOverlay";
const EMOJI_SIZE_RATIO = 1.05;
const EMOJI_ADVANCE_RATIO = 1.13;
const EMOJI_LEADING_GAP_RATIO = EMOJI_ADVANCE_RATIO - EMOJI_SIZE_RATIO;
const DEFAULT_FFMPEG_PATH = getPackagedFfmpegPath();
const assetDataUriCache = new Map();
const CAPTION_FONT_DESC = "Noto Sans";
const CAPTION_BOLD_FONT_DESC = "Noto Sans Bold";

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
  if (renderSupport?.drawtextSupported) {
    return {
      mode: "caption-burn-in",
      captionMode: "drawtext",
      burnCaptions: true,
      userStatus: "Captions will be burned into the MP4.",
      warnings: [],
    };
  }

  if (renderSupport?.imageCaptionOverlaySupported || renderSupport?.overlaySupported) {
    return {
      mode: "caption-image-overlay",
      captionMode: "image-overlay",
      burnCaptions: true,
      userStatus: "Captions will be burned into the MP4.",
      warnings: [],
      internalNote: `FFmpeg at '${ffmpegPath}' does not support drawtext, so Kick Clipper is using a generated caption PNG overlay.`,
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
  const svg = buildRenderOverlaySvg(normalized, { includeText: false });
  const basePng = await sharp(Buffer.from(svg)).png().toBuffer();
  const textComposites = await buildOverlayTextComposites(normalized);

  await maybeWriteOverlayDebugArtifacts(outputPath, svg);
  await sharp(basePng).composite(textComposites).png().toFile(outputPath);

  return outputPath;
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

export function buildRenderOverlaySvg(payload, options = {}) {
  const normalized = normalizeRenderPayload(payload);
  const target = normalized.target;
  const kickBranding = normalizeKickBranding(normalized.kickBranding);
  const includeText = options.includeText !== false;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${target.width}" height="${target.height}" viewBox="0 0 ${target.width} ${target.height}">`,
    `<defs>${overlayFontFaceCss()}<filter id="captionBubbleShadow" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="4" stdDeviation="12" flood-color="#000000" flood-opacity="0.12"/></filter></defs>`,
    `<rect width="100%" height="100%" fill="transparent" />`,
    buildCaptionSvgLayer(normalized, { includeText }),
    kickBranding.enabled ? buildKickBrandingSvgLayer(normalized, kickBranding, { includeText }) : "",
    "</svg>",
  ].join("");
}

export function getKickBrandingRect(payload) {
  const normalized = normalizeRenderPayload(payload);
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

function createCaptionLayout(normalized) {
  const rect = normalized.captionRect;
  const target = normalized.target;
  const style = normalizeCaptionStyle(normalized.captionStyle);
  const isLowerCaption = isLowerCaptionRect(rect, target);
  const fontSize = Math.round((style.fontSize ?? 64) * (isLowerCaption ? 0.82 : 1));
  const textWidthScale = isLowerCaption ? 1.35 : 1;
  const edgeMargin = 48;
  const paddingX = isLowerCaption
    ? Math.max(34, Math.round(fontSize * 0.52))
    : Math.max(52, Math.round(fontSize * 0.72));
  const paddingY = isLowerCaption
    ? Math.max(20, Math.round(fontSize * 0.3))
    : Math.max(20, Math.round(fontSize * 0.32));
  const maxBoxWidth = Math.min(rect.width, target.width - 2 * edgeMargin);
  const textWrapWidth = Math.max(fontSize * 3, maxBoxWidth - 2 * paddingX);
  logCaptionEmojiAssets(normalized.captionText);
  const lines = wrapCaptionText(normalized.captionText, textWrapWidth, fontSize, textWidthScale);
  const lineHeight = Math.round(fontSize * (isLowerCaption ? 1.1 : 1.16));
  const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
  const estimatedLineWidths = lines.map((line) => estimateTextWidth(line, fontSize) * textWidthScale);
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
  const blockY = boxY + paddingY;
  const textColor = svgColor(style.textColor);
  const backgroundColor = style.background === "black" ? "#050505" : "#ffffff";
  const backgroundOpacity = style.background === "black" ? "0.86" : "0.98";

  return {
    backgroundColor,
    backgroundOpacity,
    blockY,
    boxHeight,
    boxWidth,
    boxX,
    boxY,
    fontSize,
    isLowerCaption,
    lineHeight,
    lines,
    style,
    textColor,
    textRect,
    textWidthScale,
  };
}

function buildCaptionSvgLayer(normalized, options = {}) {
  const {
    backgroundColor,
    backgroundOpacity,
    blockY,
    boxHeight,
    boxWidth,
    boxX,
    boxY,
    fontSize,
    isLowerCaption,
    lineHeight,
    lines,
    style,
    textColor,
    textRect,
    textWidthScale,
  } = createCaptionLayout(normalized);
  const includeText = options.includeText !== false;
  const textShadow = style.background === "none"
    ? [
        svgRichTextLines(lines, lineHeight, textRect, blockY, fontSize, "#000000", {
          includeText,
          opacity: 0.9,
          offsetY: 4,
          textWidthScale,
        }),
      ].join("")
    : "";
  const background = style.background === "none"
    ? ""
    : `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="${isLowerCaption ? 24 : 30}" ry="${isLowerCaption ? 24 : 30}" fill="${backgroundColor}" opacity="${backgroundOpacity}" filter="url(#captionBubbleShadow)" />`;

  return [
    background,
    textShadow,
    svgRichTextLines(lines, lineHeight, textRect, blockY, fontSize, textColor, { includeText, textWidthScale }),
  ].join("");
}

function createKickBrandingLayout(normalized, kickBranding) {
  const rect = getKickBrandingRect(normalized);
  const logoWidth = Math.round(rect.width * 0.22);
  const logoHeight = Math.round(rect.height * 0.68);
  const linkFontSize = Math.round(rect.height * 0.36);
  const centerY = rect.y + rect.height / 2;
  const logoX = Math.round(rect.x + rect.width * 0.065);
  const logoY = Math.round(centerY - logoHeight / 2);
  const linkX = Math.round(logoX + logoWidth + rect.width * 0.048);
  const logoDataUri = assetDataUri(KICK_LOGO_PATH, "image/png");
  const linkText = kickBranding.link.toUpperCase();

  return {
    centerY,
    linkFontSize,
    linkText,
    linkX,
    logoDataUri,
    logoHeight,
    logoWidth,
    logoX,
    logoY,
    rect,
  };
}

function buildKickBrandingSvgLayer(normalized, kickBranding, options = {}) {
  const {
    centerY,
    linkFontSize,
    linkText,
    linkX,
    logoDataUri,
    logoHeight,
    logoWidth,
    logoX,
    logoY,
    rect,
  } = createKickBrandingLayout(normalized, kickBranding);
  const includeText = options.includeText !== false;

  return [
    `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#030303" opacity="0.9" />`,
    `<image href="${logoDataUri}" x="${logoX}" y="${logoY}" width="${logoWidth}" height="${logoHeight}" preserveAspectRatio="xMidYMid slice" />`,
    includeText
      ? `<text x="${linkX}" y="${Math.round(centerY + linkFontSize * 0.34)}" fill="#ffffff" font-family="${OVERLAY_FONT_FAMILY}" font-size="${linkFontSize}" font-weight="900" text-anchor="start">${escapeXml(linkText)}</text>`
      : "",
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

function isLowerCaptionRect(rect, target) {
  return rect.y + rect.height / 2 >= target.height * 0.5;
}

function wrapCaptionText(text, maxWidth, fontSize, textWidthScale = 1) {
  const words = String(text)
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (currentLine && estimateTextWidth(nextLine, fontSize) * textWidthScale > maxWidth) {
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

function svgRichTextLines(lines, lineHeight, rect, y, fontSize, fill, options = {}) {
  const includeText = options.includeText !== false;
  const textWidthScale = options.textWidthScale ?? 1;

  return lines
    .map((line, index) => {
      const lineWidth = estimateTextWidth(line, fontSize) * textWidthScale;
      const baselineY = Math.round(y + fontSize + index * lineHeight + (options.offsetY ?? 0));
      let cursorX = Math.round(rect.x + (rect.width - lineWidth) / 2);

      return tokenizeCaptionLine(line)
        .map((token) => {
          if (token.type === "emoji") {
            const icon = emojiSvg(
              token,
              cursorX + fontSize * EMOJI_LEADING_GAP_RATIO,
              baselineY,
              fontSize,
              options,
            );
            cursorX += fontSize * EMOJI_ADVANCE_RATIO;
            return icon;
          }

          if (!includeText) {
            cursorX += estimateTextWidth(token.value, fontSize) * textWidthScale;
            return "";
          }

          const width = estimateTextWidth(token.value, fontSize) * textWidthScale;
          const text = [
            `<text x="${cursorX}" y="${baselineY}" fill="${fill}"`,
            `font-family="${OVERLAY_FONT_FAMILY}"`,
            `font-size="${fontSize}" font-weight="400" text-anchor="start"`,
            options.opacity ? `opacity="${options.opacity}"` : "",
            `>${escapeXml(token.value)}</text>`,
          ].filter(Boolean).join(" ");
          cursorX += width;
          return text;
        })
        .join("");
    })
    .join("");
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

function overlayFontFaceCss() {
  return [
    "<style>",
    "@font-face{",
    `font-family:'${OVERLAY_FONT_FAMILY}';`,
    `src:url('${assetDataUri(OVERLAY_FONT_PATH, "font/ttf")}') format('truetype');`,
    "font-weight:400;",
    "font-style:normal;",
    "}",
    "</style>",
  ].join("");
}

async function buildOverlayTextComposites(normalized) {
  const composites = await buildCaptionTextComposites(normalized);
  const kickBranding = normalizeKickBranding(normalized.kickBranding);

  if (kickBranding.enabled) {
    composites.push(await buildKickLinkTextComposite(normalized, kickBranding));
  }

  return composites.filter(Boolean);
}

async function buildCaptionTextComposites(normalized) {
  const { blockY, fontSize, isLowerCaption, lineHeight, lines, textColor, textRect, textWidthScale } = createCaptionLayout(normalized);
  const composites = [];
  const renderFontSize = Math.round(fontSize * (isLowerCaption ? 0.72 : 0.72));

  for (const [index, line] of lines.entries()) {
    const lineWidth = estimateTextWidth(line, fontSize) * textWidthScale;
    const baselineY = Math.round(blockY + fontSize + index * lineHeight);
    let cursorX = Math.round(textRect.x + (textRect.width - lineWidth) / 2);

    for (const token of tokenizeCaptionLine(line)) {
      const width = estimateTextWidth(token.value, fontSize) * (token.type === "emoji" ? 1 : textWidthScale);

      if (token.type !== "emoji") {
        composites.push(await createTextComposite({
          baselineY,
          fill: textColor,
          fontDesc: isLowerCaption ? CAPTION_BOLD_FONT_DESC : CAPTION_FONT_DESC,
          fontSize,
          left: cursorX,
          renderFontSize,
          text: token.value,
          topOffset: isLowerCaption ? -6 : 0,
          width,
        }));
      }

      cursorX += token.type === "emoji"
        ? fontSize * EMOJI_ADVANCE_RATIO
        : width;
    }
  }

  return composites;
}

async function buildKickLinkTextComposite(normalized, kickBranding) {
  const { centerY, linkFontSize, linkText, linkX } = createKickBrandingLayout(normalized, kickBranding);
  const renderFontSize = Math.round(linkFontSize * 1.04);
  const textHeight = Math.ceil(renderFontSize * 1.42);

  return createTextComposite({
    baselineY: Math.round(centerY + linkFontSize * 0.34),
    fill: "#ffffff",
    fontDesc: CAPTION_BOLD_FONT_DESC,
    fontSize: linkFontSize,
    heightRatio: 1.42,
    left: linkX,
    renderFontSize,
    stretchX: 0.82,
    text: linkText,
    top: Math.round(centerY - textHeight / 2),
    width: estimateTextWidth(linkText, linkFontSize),
  });
}

async function createTextComposite({
  baselineY,
  fill,
  fontDesc = CAPTION_FONT_DESC,
  fontSize,
  heightRatio = 1.8,
  left,
  renderFontSize,
  stretchX = 1,
  text,
  top,
  topOffset = 0,
  width,
}) {
  const rasterFontSize = renderFontSize ?? fontSize;
  const textWidth = Math.max(8, Math.ceil(width + rasterFontSize * 2.2));
  const textHeight = Math.max(8, Math.ceil(rasterFontSize * heightRatio));
  const textTop = top ?? Math.round(baselineY - rasterFontSize * 1.05 + topOffset);
  let input = await renderTextPng(text, rasterFontSize, fill, textWidth, textHeight, fontDesc);

  if (stretchX !== 1) {
    input = await sharp(input)
      .resize({
        width: Math.max(1, Math.round(textWidth * stretchX)),
        height: textHeight,
        fit: "fill",
      })
      .png()
      .toBuffer();
  }

  return {
    input,
    left: Math.round(left),
    top: textTop,
  };
}

async function renderTextPng(text, fontSize, fill, width, height, fontDesc = CAPTION_FONT_DESC) {
  return sharp({
    text: {
      text: `<span font_desc="${escapePangoAttribute(`${fontDesc} ${fontSize}`)}" foreground="${escapePangoAttribute(fill)}">${escapePangoText(text)}</span>`,
      font: "Noto Sans",
      fontfile: OVERLAY_FONT_PATH,
      height,
      rgba: true,
      width,
    },
  }).png().toBuffer();
}

async function maybeWriteOverlayDebugArtifacts(outputPath, svg) {
  if (!process.env.KICK_CLIPPER_DEBUG_OVERLAY) {
    return;
  }

  const debugPath = `${outputPath}.svg`;
  await fsWriteFile(debugPath, svg);
  console.info(`[kick-clipper] wrote overlay debug SVG: ${debugPath}`);
}

function parseCaptionEmojiTokens(text) {
  return parseTwemoji(String(text)).map((emoji) => {
    const assetFilename = emojiAssetFilename(emoji);
    const assetPath = assetFilename ? path.join(getTwemojiAssetDir(), assetFilename) : null;
    const codepoints = assetFilename
      ? assetFilename.replace(/\.svg$/i, "")
      : codepointsFromText(emoji.text);

    return {
      ...emoji,
      assetFilename,
      assetPath,
      codepoints,
      assetExists: Boolean(assetPath && existsSync(assetPath)),
    };
  });
}

function getTwemojiAssetDir() {
  return process.env.TWEMOJI_ASSET_DIR || DEFAULT_TWEMOJI_ASSET_DIR;
}

function emojiAssetFilename(emoji) {
  try {
    const url = new URL(emoji.url);
    const filename = path.basename(url.pathname);
    return /^[0-9a-f-]+\.svg$/i.test(filename) ? filename.toLowerCase() : null;
  } catch {
    return null;
  }
}

function codepointsFromText(text) {
  return Array.from(text)
    .map((char) => char.codePointAt(0).toString(16))
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

function emojiSvg(token, x, baselineY, fontSize, options = {}) {
  if (options.opacity) {
    return "";
  }

  const emoji = token.emoji;
  if (!emoji?.assetExists) {
    return nativeEmojiTextSvg(token.value, x, baselineY, fontSize);
  }

  const size = Math.round(fontSize * EMOJI_SIZE_RATIO);
  const y = Math.round(baselineY - size * 0.83);
  const href = assetDataUri(emoji.assetPath, "image/svg+xml");

  return `<image href="${href}" x="${Math.round(x)}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" />`;
}

function nativeEmojiTextSvg(emoji, x, baselineY, fontSize) {
  return [
    `<text x="${Math.round(x)}" y="${baselineY}" fill="#000000"`,
    `font-family="${OVERLAY_FONT_FAMILY}"`,
    `font-size="${fontSize}" font-weight="400" text-anchor="start"`,
    `>${escapeXml(emoji)}</text>`,
  ].join(" ");
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

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function escapePangoText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapePangoAttribute(value) {
  return escapePangoText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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
