import {
  getDefaultSafeZones,
  overlapArea,
  severityWeight,
  toPixelRect,
} from "./safeZones.js";

export const CAPTION_POSITIONS = {
  top: "top",
  middle: "middle",
  lowerSafe: "lower-safe",
  custom: "custom",
};

export const DEFAULT_CAPTION_BOX = {
  widthRatio: 0.84,
  heightRatio: 0.14,
};

/**
 * Returns the four position families the product exposes. The UI can display
 * these labels directly, while render/export code can convert them into pixel
 * rectangles with getCaptionRect.
 */
export function getRecommendedCaptionPositions() {
  return [
    {
      id: CAPTION_POSITIONS.top,
      label: "Top",
      description: "Useful when the bottom of the clip is busy or watermarked.",
    },
    {
      id: CAPTION_POSITIONS.middle,
      label: "Middle",
      description: "Centered captions for clips with clear center action.",
    },
    {
      id: CAPTION_POSITIONS.lowerSafe,
      label: "Lower safe",
      description: "Lower-third style captions raised above Kick watermark/UI risk zones.",
    },
    {
      id: CAPTION_POSITIONS.custom,
      label: "Custom",
      description: "Caller-provided x/y position for manual adjustment.",
    },
  ];
}

export function getCaptionRect(position, frame, options = {}) {
  const box = resolveCaptionBox(frame, options.captionBox);
  const marginX = Math.round(frame.width * 0.08);
  const safeTop = Math.round(frame.height * 0.14);
  const lowerSafeY = Math.round(frame.height * 0.58);

  if (position === CAPTION_POSITIONS.custom) {
    if (!options.customRect) {
      throw new Error("customRect is required when position is custom");
    }

    return clampRect(options.customRect, frame);
  }

  const centeredX = Math.round((frame.width - box.width) / 2);

  if (position === CAPTION_POSITIONS.top) {
    return clampRect({ x: centeredX, y: safeTop, ...box }, frame);
  }

  if (position === CAPTION_POSITIONS.middle) {
    return clampRect(
      { x: centeredX, y: Math.round((frame.height - box.height) / 2), ...box },
      frame,
    );
  }

  if (position === CAPTION_POSITIONS.lowerSafe) {
    // Lower-safe is intentionally raised above the bottom UI and watermark zones.
    return clampRect({ x: marginX, y: lowerSafeY, ...box }, frame);
  }

  throw new Error(`Unknown caption position: ${position}`);
}

/**
 * Chooses the least risky caption position. When avoidWatermark is enabled we
 * score every built-in position against safe zones and prefer the one with the
 * smallest overlap. This is simple enough for an MVP demo but still captures
 * the important product promise: do not cover Kick branding or mobile UI.
 */
export function getBestCaptionPosition(input) {
  const {
    frame,
    avoidWatermark = true,
    watermarkCorner,
    captionBox,
    customRect,
    safeZones = getDefaultSafeZones({ watermarkCorner }),
    allowedPositions = [
      CAPTION_POSITIONS.lowerSafe,
      CAPTION_POSITIONS.middle,
      CAPTION_POSITIONS.top,
    ],
  } = input;

  const scored = allowedPositions.map((position) => {
    const rect = getCaptionRect(position, frame, { captionBox, customRect });
    const risk = scoreCaptionRisk(rect, frame, safeZones, {
      ignoreWatermarkZones: !avoidWatermark,
    });

    return { position, rect, risk };
  });

  scored.sort((a, b) => {
    if (a.risk.score !== b.risk.score) {
      return a.risk.score - b.risk.score;
    }

    return positionPreference(a.position) - positionPreference(b.position);
  });

  return {
    ...scored[0],
    candidates: scored,
  };
}

export function scoreCaptionRisk(rect, frame, safeZones, options = {}) {
  const zones = safeZones.filter((zone) => {
    return !(options.ignoreWatermarkZones && zone.id.startsWith("kick-watermark-"));
  });

  const overlaps = zones
    .map((zone) => {
      const zoneRect = toPixelRect(zone.rect, frame);
      const area = overlapArea(rect, zoneRect);
      const weightedArea = area * severityWeight(zone.severity);

      return {
        zoneId: zone.id,
        label: zone.label,
        severity: zone.severity,
        area,
        weightedArea,
      };
    })
    .filter((overlap) => overlap.area > 0);

  return {
    score: overlaps.reduce((sum, overlap) => sum + overlap.weightedArea, 0),
    overlaps,
  };
}

export function resolveCaptionBox(frame, captionBox = DEFAULT_CAPTION_BOX) {
  return {
    width: Math.round(frame.width * (captionBox.widthRatio ?? DEFAULT_CAPTION_BOX.widthRatio)),
    height: Math.round(frame.height * (captionBox.heightRatio ?? DEFAULT_CAPTION_BOX.heightRatio)),
  };
}

function positionPreference(position) {
  if (position === CAPTION_POSITIONS.lowerSafe) return 0;
  if (position === CAPTION_POSITIONS.middle) return 1;
  if (position === CAPTION_POSITIONS.top) return 2;
  return 3;
}

function clampRect(rect, frame) {
  const width = Math.min(rect.width, frame.width);
  const height = Math.min(rect.height, frame.height);

  return {
    x: Math.max(0, Math.min(Math.round(rect.x), frame.width - width)),
    y: Math.max(0, Math.min(Math.round(rect.y), frame.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}
