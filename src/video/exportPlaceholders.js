import {
  CAPTION_POSITIONS,
  getBestCaptionPosition,
  getCaptionRect,
  scoreCaptionRisk,
} from "./captionPositions.js";
import { createPersonAwareReelPlan } from "./personFraming.js";
import { createCaptionRenderPlan, createDrawTextPlaceholder } from "./rendering.js";
import { getDefaultSafeZones } from "./safeZones.js";

/**
 * Builds an export plan without running FFmpeg. Backend can replace this with
 * real process execution while keeping the same inputs and caption decisions.
 */
export function createKickClipExportPlan(input) {
  const reelPlan = createPersonAwareReelPlan({
    source: input.source,
    target: input.target,
    subjectDetections: input.subjectDetections ?? input.faceDetections ?? input.personDetections ?? [],
    faceBox: input.faceBox,
    faceConfidence: input.faceConfidence,
    headBox: input.headBox,
    headConfidence: input.headConfidence,
  });
  const frame = reelPlan.target;
  const baseSafeZones = input.safeZones ?? getDefaultSafeZones({
    watermarkCorner: input.watermarkCorner,
  });
  const safeZones = reelPlan.faceSafeZone
    ? [...baseSafeZones, reelPlan.faceSafeZone]
    : baseSafeZones;
  const bestCaption = getBestCaptionPosition({
    frame,
    avoidWatermark: input.avoidWatermark ?? true,
    watermarkCorner: input.watermarkCorner,
    captionBox: input.captionBox,
    safeZones,
  });
  const requestedCaption = resolveRequestedCaption(input, frame, safeZones, bestCaption);
  const captionRenderPlan = createCaptionRenderPlan({
    text: input.captionText,
    frame,
    position: requestedCaption.position,
    captionBox: input.captionBox,
    customRect: requestedCaption.customRect,
    captionStyle: input.captionStyle,
  });
  const drawText = createDrawTextPlaceholder(captionRenderPlan);
  const kickBranding = resolveKickBranding(input.kickBranding);
  const kickBrandingOverlay = createKickBrandingPlaceholder(kickBranding, frame);

  return {
    status: "planned",
    videoId: input.videoId,
    jobId: input.jobId,
    sourcePath: input.sourcePath,
    outputPath: input.outputPath,
    reelPlan,
    selectedCrop: reelPlan.selectedCrop,
    detectedPrimarySubject: reelPlan.detectedPrimarySubject,
    faceSafeZone: reelPlan.faceSafeZone,
    fallbackReason: reelPlan.fallbackReason,
    bestCaption,
    requestedCaption,
    captionRenderPlan,
    captionStyle: captionRenderPlan.style,
    captionRect: captionRenderPlan.rect,
    kickBranding,
    kickBrandingOverlay,
    safeZones,
    ffmpeg: {
      executable: input.ffmpegPath ?? "ffmpeg",
      argsPreview: [
        "-i",
        input.sourcePath ?? "<input>",
        "-vf",
        [
          reelPlan.ffmpegFilter,
          ...kickBrandingOverlay.filters,
          drawText.filter,
        ].join(","),
        input.outputPath ?? "<output>",
      ],
      note: "Placeholder only: this does not spawn FFmpeg yet.",
    },
  };
}

function createKickBrandingPlaceholder(branding, frame) {
  if (!branding.enabled) {
    return {
      type: "kick-branding-placeholder",
      filters: [],
      note: "Kick branding disabled.",
    };
  }

  const barHeight = Math.round(frame.height * 0.056);
  const barY = Math.round(frame.height * 0.779);
  const logoFontSize = Math.round(barHeight * 0.72);
  const linkFontSize = Math.round(barHeight * 0.34);

  return {
    type: "kick-branding-placeholder",
    logoAssetPath: branding.style.logoAssetPath,
    filters: [
      `drawbox=x=0:y=${barY}:w=iw:h=${barHeight}:color=black@0.96:t=fill`,
      [
        `drawtext=text='KICK'`,
        "x=72",
        `y=${barY + Math.round(barHeight * 0.12)}`,
        `fontsize=${logoFontSize}`,
        "fontcolor=0x53fc18",
      ].join(":"),
      [
        `drawtext=text='${escapeDrawText(branding.link.toUpperCase())}'`,
        "x=(w-text_w)/2",
        `y=${barY + Math.round(barHeight * 0.32)}`,
        `fontsize=${linkFontSize}`,
        "fontcolor=white",
      ].join(":"),
    ],
    note: "Placeholder only: final export should overlay the PNG logo asset and wire font files.",
  };
}

function resolveKickBranding(branding = {}) {
  return {
    enabled: branding.enabled !== false,
    link: normalizeKickLink(branding.link),
    style: {
      barColor: "black",
      logoAssetPath: "/brand/kick-logo.png",
      logoColor: "#53fc18",
      textColor: "white",
      placement: "lower-horizontal-bar",
    },
  };
}

function normalizeKickLink(value) {
  const trimmed = String(value || "kick.com/clavicular").trim();

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/g, "");
}

function escapeDrawText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function resolveRequestedCaption(input, frame, safeZones, bestCaption) {
  const requestedPosition = input.captionPosition ?? bestCaption.position;
  const customRect = requestedPosition === CAPTION_POSITIONS.custom ? input.customRect : undefined;
  const requestedRect = getCaptionRect(requestedPosition, frame, {
    captionBox: input.captionBox,
    customRect,
  });
  const requestedRisk = scoreCaptionRisk(requestedRect, frame, safeZones, {
    ignoreWatermarkZones: !(input.avoidWatermark ?? true),
  });

  if ((input.avoidWatermark ?? true) && requestedRisk.score > 0) {
    return {
      position: bestCaption.position,
      rect: bestCaption.rect,
      risk: bestCaption.risk,
      requestedPosition,
      adjustedForSafety: true,
    };
  }

  return {
    position: requestedPosition,
    rect: requestedRect,
    risk: requestedRisk,
    requestedPosition,
    customRect,
    adjustedForSafety: false,
  };
}
