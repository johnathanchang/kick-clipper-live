import { getCaptionRect } from "./captionPositions.js";

/**
 * Converts a caption position into a renderer-friendly payload. Frontend can
 * use the rect for preview overlays; export code can use the same rect to build
 * FFmpeg drawtext filters later.
 */
export function createCaptionRenderPlan({
  text,
  frame,
  position,
  captionBox,
  customRect,
  captionStyle,
}) {
  const rect = getCaptionRect(position, frame, { captionBox, customRect });
  const resolvedStyle = resolveCaptionStyle(captionStyle);

  return {
    text,
    rect,
    style: resolvedStyle,
    align: "center",
    verticalAlign: "middle",
    maxWidth: rect.width,
  };
}

/**
 * This helper is intentionally small. It gives export work a stable placeholder
 * for FFmpeg drawtext without pretending typography is finished.
 */
export function createDrawTextPlaceholder(renderPlan) {
  const style = resolveCaptionStyle(renderPlan.style);
  const filter = [
    `drawtext=text='${escapeDrawText(renderPlan.text)}'`,
    `x=${renderPlan.rect.x}`,
    `y=${renderPlan.rect.y}`,
    `fontcolor=${style.textColor}`,
    `fontsize=${style.fontSize ?? 64}`,
  ];

  if (style.background !== "none") {
    filter.push(
      "box=1",
      `boxcolor=${style.background === "white" ? "white@0.96" : "black@0.82"}`,
      "boxborderw=24",
    );
  } else {
    filter.push("borderw=4", "bordercolor=black@0.9");
  }

  return {
    type: "ffmpeg-drawtext-placeholder",
    filter: filter.join(":"),
    note: "Placeholder only: final export should wire font file, rounded caption box, wrapping, and line height.",
  };
}

export function resolveCaptionStyle(style = {}) {
  const background = ["white", "black", "none"].includes(style.background)
    ? style.background
    : "white";
  const textColor = background === "white" ? "black" : "white";

  return {
    preset: style.preset ?? "classic-tiktok",
    background,
    textColor: style.textColor ?? textColor,
    fontFamily: style.fontFamily ?? "Arial Rounded MT Bold, Arial Black, Impact, sans-serif",
    fontSize: style.fontSize,
  };
}

function escapeDrawText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}
