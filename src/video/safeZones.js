export const WATERMARK_CORNERS = {
  unknown: "unknown",
  bottomLeft: "bottom-left",
  bottomRight: "bottom-right",
};

export const DEFAULT_SAFE_ZONE_OPTIONS = {
  watermarkCorner: WATERMARK_CORNERS.unknown,
  includePlatformUi: true,
};

/**
 * Safe zones are normalized rectangles where x/y/width/height are 0..1.
 * Keeping them normalized lets frontend preview, backend rendering, and tests
 * use the same rules for every output size, including 1080x1920 Reels.
 */
export function getDefaultSafeZones(options = {}) {
  const resolved = { ...DEFAULT_SAFE_ZONE_OPTIONS, ...options };
  const zones = [];

  if (resolved.includePlatformUi) {
    zones.push(
      {
        id: "top-profile-ui",
        label: "Top Kick UI",
        severity: "medium",
        rect: { x: 0, y: 0, width: 1, height: 0.12 },
        reason: "Kick clips often have creator/channel UI near the top edge.",
      },
      {
        id: "bottom-controls-ui",
        label: "Bottom playback UI",
        severity: "high",
        rect: { x: 0, y: 0.84, width: 1, height: 0.16 },
        reason: "Bottom controls and mobile app chrome can cover captions.",
      },
      {
        id: "left-edge-gutter",
        label: "Left edge gutter",
        severity: "low",
        rect: { x: 0, y: 0, width: 0.06, height: 1 },
        reason: "Avoid placing text too close to cropped video edges.",
      },
      {
        id: "right-edge-gutter",
        label: "Right edge gutter",
        severity: "low",
        rect: { x: 0.94, y: 0, width: 0.06, height: 1 },
        reason: "Avoid placing text too close to cropped video edges.",
      },
    );
  }

  for (const corner of resolveWatermarkCorners(resolved.watermarkCorner)) {
    zones.push(createKickWatermarkSafeZone(corner));
  }

  return zones;
}

/**
 * Kick watermark placement is not guaranteed for every downloaded clip. For
 * the MVP, when the exact corner is unknown, we reserve both bottom corners.
 * This makes the demo conservative and clearly shows that captions avoid
 * likely platform branding and UI overlays.
 */
export function resolveWatermarkCorners(watermarkCorner) {
  if (watermarkCorner === WATERMARK_CORNERS.bottomLeft) {
    return [WATERMARK_CORNERS.bottomLeft];
  }

  if (watermarkCorner === WATERMARK_CORNERS.bottomRight) {
    return [WATERMARK_CORNERS.bottomRight];
  }

  return [WATERMARK_CORNERS.bottomLeft, WATERMARK_CORNERS.bottomRight];
}

export function createKickWatermarkSafeZone(corner) {
  const isLeft = corner === WATERMARK_CORNERS.bottomLeft;

  return {
    id: `kick-watermark-${corner}`,
    label: `Kick watermark ${corner}`,
    severity: "high",
    rect: {
      x: isLeft ? 0 : 0.68,
      y: 0.76,
      width: 0.32,
      height: 0.18,
    },
    reason: "Kick watermark or app overlay commonly appears in a bottom corner.",
  };
}

export function toPixelRect(rect, frame) {
  return {
    x: Math.round(rect.x * frame.width),
    y: Math.round(rect.y * frame.height),
    width: Math.round(rect.width * frame.width),
    height: Math.round(rect.height * frame.height),
  };
}

export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function overlapArea(a, b) {
  if (!rectsOverlap(a, b)) {
    return 0;
  }

  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return Math.max(0, right - x) * Math.max(0, bottom - y);
}

export function severityWeight(severity) {
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}
