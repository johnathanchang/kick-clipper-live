export const SUBJECT_KINDS = {
  face: "face",
  head: "head",
  upperBody: "upper-body",
  person: "person",
};

const KIND_WEIGHT = {
  [SUBJECT_KINDS.face]: 4,
  [SUBJECT_KINDS.head]: 3.5,
  [SUBJECT_KINDS.upperBody]: 2.5,
  [SUBJECT_KINDS.person]: 1.5,
};

const SUBJECT_SAFE_ZONE_ID = "primary-subject-face";
const DEFAULT_REEL_TARGET = {
  width: 1080,
  height: 1920,
};

/**
 * Placeholder adapter for future MediaPipe/OpenCV/Roboflow integration.
 * The product code already accepts sampled boxes, so a real detector only
 * needs to return the same shape this adapter documents:
 * { kind, box: { x, y, width, height }, confidence, frameTimeMs }.
 */
export async function detectSubjectBoxesPlaceholder() {
  return [];
}

export function createPersonAwareReelPlan(input) {
  const target = input.target ?? DEFAULT_REEL_TARGET;
  const centerCrop = createBaseCrop(input.source, target);
  const detectedPrimarySubject = selectPrimarySubject(
    collectSubjectDetections(input),
    input.source,
  );

  if (!detectedPrimarySubject) {
    return buildPlan({
      source: input.source,
      target,
      selectedCrop: centerCrop,
      detectedPrimarySubject: null,
      fallbackReason: "no-face-or-person-detected",
    });
  }

  const subjectSafeBox = createSubjectSafeBox(detectedPrimarySubject.box, input.source);
  const selectedCrop = chooseSubjectAwareCrop({
    source: input.source,
    baseCrop: centerCrop,
    subjectBox: subjectSafeBox,
  });

  return buildPlan({
    source: input.source,
    target,
    selectedCrop,
    detectedPrimarySubject,
    subjectSafeBox,
    fallbackReason: null,
  });
}

export function selectPrimarySubject(detections = [], source) {
  const candidates = detections
    .map((detection, index) => normalizeDetection(detection, source, index))
    .filter(Boolean);

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ?? null;
}

export function collectSubjectDetections(input = {}) {
  const detections = [...(input.subjectDetections ?? [])];

  if (input.faceBox) {
    detections.push({
      id: "provided-face-box",
      kind: SUBJECT_KINDS.face,
      confidence: input.faceConfidence ?? 1,
      box: input.faceBox,
    });
  }

  if (input.headBox) {
    detections.push({
      id: "provided-head-box",
      kind: SUBJECT_KINDS.head,
      confidence: input.headConfidence ?? 1,
      box: input.headBox,
    });
  }

  return detections;
}

export function createSubjectFaceSafeZone(subjectSafeBox, selectedCrop) {
  if (!subjectSafeBox) {
    return null;
  }

  const transformed = transformSourceRectToCrop(subjectSafeBox, selectedCrop);
  const normalizedRect = {
    x: clamp01(transformed.x / selectedCrop.width),
    y: clamp01(transformed.y / selectedCrop.height),
    width: clamp01(transformed.width / selectedCrop.width),
    height: clamp01(transformed.height / selectedCrop.height),
  };

  return {
    id: SUBJECT_SAFE_ZONE_ID,
    label: "Primary face/person",
    severity: "high",
    rect: normalizedRect,
    reason: "Keep captions away from the streamer's face, head, and upper body.",
  };
}

export function transformSourceRectToTarget(rect, selectedCrop, target = DEFAULT_REEL_TARGET) {
  const transformed = transformSourceRectToCrop(rect, selectedCrop);

  return {
    x: Math.round((transformed.x / selectedCrop.width) * target.width),
    y: Math.round((transformed.y / selectedCrop.height) * target.height),
    width: Math.round((transformed.width / selectedCrop.width) * target.width),
    height: Math.round((transformed.height / selectedCrop.height) * target.height),
  };
}

function buildPlan({
  source,
  target,
  selectedCrop,
  detectedPrimarySubject,
  subjectSafeBox,
  fallbackReason,
}) {
  const faceSafeZone = createSubjectFaceSafeZone(subjectSafeBox, selectedCrop);

  return {
    source: { width: source.width, height: source.height },
    target: { width: target.width, height: target.height },
    crop: selectedCrop,
    selectedCrop,
    detectedPrimarySubject,
    faceSafeZone,
    fallbackReason,
    scale: {
      width: target.width,
      height: target.height,
    },
    ffmpegFilter: `crop=${selectedCrop.width}:${selectedCrop.height}:${selectedCrop.x}:${selectedCrop.y},scale=${target.width}:${target.height}`,
  };
}

function createBaseCrop(source, target) {
  assertPositiveSize(source, "source");
  assertPositiveSize(target, "target");

  const sourceRatio = source.width / source.height;
  const targetRatio = target.width / target.height;
  let width = source.width;
  let height = source.height;
  let x = 0;
  let y = 0;

  if (sourceRatio > targetRatio) {
    width = Math.round(source.height * targetRatio);
    x = Math.round((source.width - width) / 2);
  } else if (sourceRatio < targetRatio) {
    height = Math.round(source.width / targetRatio);
    y = Math.round((source.height - height) / 2);
  }

  return { x, y, width, height };
}

function chooseSubjectAwareCrop({ source, baseCrop, subjectBox }) {
  const desiredSubjectPosition = {
    // People read best slightly above true center in vertical reels.
    x: 0.5,
    y: 0.38,
  };
  let x = Math.round(subjectBox.x + subjectBox.width / 2 - baseCrop.width * desiredSubjectPosition.x);
  let y = Math.round(subjectBox.y + subjectBox.height / 2 - baseCrop.height * desiredSubjectPosition.y);

  x = fitCropAxis({
    cropStart: x,
    cropSize: baseCrop.width,
    sourceSize: source.width,
    safeStart: subjectBox.x,
    safeEnd: subjectBox.x + subjectBox.width,
  });
  y = fitCropAxis({
    cropStart: y,
    cropSize: baseCrop.height,
    sourceSize: source.height,
    safeStart: subjectBox.y,
    safeEnd: subjectBox.y + subjectBox.height,
  });

  return {
    x,
    y,
    width: baseCrop.width,
    height: baseCrop.height,
  };
}

function fitCropAxis({ cropStart, cropSize, sourceSize, safeStart, safeEnd }) {
  let start = clamp(cropStart, 0, sourceSize - cropSize);

  // If the face/head safe box fits inside the crop, shift just enough to keep
  // the full head visible. This protects reactions near the left/right edges.
  if (safeEnd - safeStart <= cropSize) {
    if (safeStart < start) {
      start = safeStart;
    }
    if (safeEnd > start + cropSize) {
      start = safeEnd - cropSize;
    }
  }

  return Math.round(clamp(start, 0, sourceSize - cropSize));
}

function createSubjectSafeBox(box, source) {
  const headPaddingX = box.width * 0.4;
  const headPaddingTop = box.height * 0.75;
  const bodyPaddingBottom = box.height * 1.25;

  return clampBox(
    {
      x: box.x - headPaddingX,
      y: box.y - headPaddingTop,
      width: box.width + headPaddingX * 2,
      height: box.height + headPaddingTop + bodyPaddingBottom,
    },
    source,
  );
}

function normalizeDetection(detection, source, index) {
  const rawBox = detection?.box ?? detection;
  if (!rawBox) {
    return null;
  }

  const box = clampBox(rawBox, source);
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }

  const kind = detection.kind ?? detection.type ?? SUBJECT_KINDS.face;
  const confidence = clamp(Number(detection.confidence ?? 1), 0, 1);
  const areaRatio = (box.width * box.height) / (source.width * source.height);
  const centerBias = 1 - Math.min(1, distanceFromCenter(box, source));
  const score = (KIND_WEIGHT[kind] ?? 1) * confidence + areaRatio * 8 + centerBias;

  return {
    id: detection.id ?? `subject-${index}`,
    kind,
    confidence,
    frameTimeMs: detection.frameTimeMs,
    box,
    score,
  };
}

function transformSourceRectToCrop(rect, selectedCrop) {
  const x = clamp(rect.x - selectedCrop.x, 0, selectedCrop.width);
  const y = clamp(rect.y - selectedCrop.y, 0, selectedCrop.height);
  const right = clamp(rect.x + rect.width - selectedCrop.x, 0, selectedCrop.width);
  const bottom = clamp(rect.y + rect.height - selectedCrop.y, 0, selectedCrop.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function distanceFromCenter(box, source) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const dx = Math.abs(centerX - source.width / 2) / (source.width / 2);
  const dy = Math.abs(centerY - source.height / 2) / (source.height / 2);

  return Math.sqrt(dx * dx + dy * dy) / Math.sqrt(2);
}

function clampBox(box, source) {
  const x = clamp(Math.round(box.x), 0, source.width);
  const y = clamp(Math.round(box.y), 0, source.height);
  const right = clamp(Math.round(box.x + box.width), 0, source.width);
  const bottom = clamp(Math.round(box.y + box.height), 0, source.height);

  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function assertPositiveSize(size, label) {
  if (!size || size.width <= 0 || size.height <= 0) {
    throw new Error(`${label} width and height must be positive numbers`);
  }
}
