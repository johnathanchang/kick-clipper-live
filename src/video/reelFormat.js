import { createPersonAwareReelPlan } from "./personFraming.js";

export const INSTAGRAM_REEL_FORMAT = {
  width: 1080,
  height: 1920,
  aspectRatio: 9 / 16,
};

/**
 * Builds a no-distortion crop plan for turning any source video into a 9:16
 * Instagram Reel frame. The source is center-cropped when it is too wide and
 * center-windowed when it is too tall, then scaled to 1080x1920.
 */
export function createInstagramReelPlan(source, target = INSTAGRAM_REEL_FORMAT) {
  return createPersonAwareReelPlan({
    source,
    target,
    subjectDetections: [],
  });
}
