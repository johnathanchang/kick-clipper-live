import test from "node:test";
import assert from "node:assert/strict";

import {
  CAPTION_POSITIONS,
  WATERMARK_CORNERS,
  createInstagramReelPlan,
  createKickClipExportPlan,
  createPersonAwareReelPlan,
  getBestCaptionPosition,
  getCaptionRect,
  getDefaultSafeZones,
  rectsOverlap,
  toPixelRect,
} from "../src/video/index.js";
import {
  RenderValidationError,
  buildCaptionOverlaySvg,
  buildFfmpegRenderArgs,
  buildJobStatusPatch,
  buildRenderOverlaySvg,
  createRenderMode,
  getKickBrandingRect,
  normalizeRenderPayload,
} from "../src/server/render/ffmpegRenderer.js";

const reelFrame = { width: 1080, height: 1920 };

test("creates a centered 9:16 crop plan for wide source videos", () => {
  const plan = createInstagramReelPlan({ width: 1920, height: 1080 });

  assert.deepEqual(plan.target, reelFrame);
  assert.equal(plan.crop.width, 608);
  assert.equal(plan.crop.height, 1080);
  assert.equal(plan.ffmpegFilter, "crop=608:1080:656:0,scale=1080:1920");
});

test("defines conservative Kick watermark zones when the corner is unknown", () => {
  const zones = getDefaultSafeZones();
  const ids = zones.map((zone) => zone.id);

  assert.ok(ids.includes("kick-watermark-bottom-left"));
  assert.ok(ids.includes("kick-watermark-bottom-right"));
  assert.ok(ids.includes("bottom-controls-ui"));
});

test("lower-safe captions stay above the bottom controls risk area", () => {
  const rect = getCaptionRect(CAPTION_POSITIONS.lowerSafe, reelFrame);

  assert.equal(rect.y, 1114);
  assert.equal(rect.height, 269);
  assert.ok(rect.y + rect.height < 0.76 * reelFrame.height);
});

test("best caption position avoids bottom watermark zones", () => {
  const result = getBestCaptionPosition({
    frame: reelFrame,
    avoidWatermark: true,
    watermarkCorner: WATERMARK_CORNERS.bottomRight,
    allowedPositions: [
      CAPTION_POSITIONS.lowerSafe,
      CAPTION_POSITIONS.middle,
      CAPTION_POSITIONS.top,
    ],
  });

  assert.equal(result.position, CAPTION_POSITIONS.lowerSafe);
  assert.equal(result.risk.score, 0);
});

test("export placeholder combines reel conversion and caption placement", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "input.mp4",
    outputPath: "output.mp4",
    captionText: "Clean clutch round",
    avoidWatermark: true,
  });

  assert.equal(plan.status, "planned");
  assert.deepEqual(plan.reelPlan.target, reelFrame);
  assert.equal(plan.bestCaption.position, CAPTION_POSITIONS.lowerSafe);
  assert.equal(plan.requestedCaption.position, CAPTION_POSITIONS.lowerSafe);
  assert.ok(plan.ffmpeg.argsPreview.includes("-vf"));
});

test("export placeholder honors a safe selected caption position", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    captionText: "Top works for this one",
    captionPosition: CAPTION_POSITIONS.top,
    avoidWatermark: true,
  });

  assert.equal(plan.requestedCaption.position, CAPTION_POSITIONS.top);
  assert.equal(plan.requestedCaption.adjustedForSafety, false);
});

test("export placeholder moves risky custom captions when watermark avoidance is enabled", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    captionText: "Move this caption",
    captionPosition: CAPTION_POSITIONS.custom,
    customRect: { x: 760, y: 1500, width: 280, height: 180 },
    avoidWatermark: true,
  });

  assert.equal(plan.requestedCaption.requestedPosition, CAPTION_POSITIONS.custom);
  assert.equal(plan.requestedCaption.position, CAPTION_POSITIONS.lowerSafe);
  assert.equal(plan.requestedCaption.adjustedForSafety, true);
});

test("export placeholder includes classic TikTok white caption style and Kick link bar", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    captionText: "Classic caption",
    captionStyle: {
      preset: "classic-tiktok",
      background: "white",
    },
    kickBranding: {
      link: "https://www.kick.com/adinross/",
    },
  });

  assert.equal(plan.captionStyle.preset, "classic-tiktok");
  assert.equal(plan.captionStyle.background, "white");
  assert.equal(plan.captionStyle.textColor, "black");
  assert.equal(plan.kickBranding.link, "kick.com/adinross");
  assert.equal(plan.kickBranding.style.logoAssetPath, "/brand/kick-logo.png");
  assert.equal(plan.kickBrandingOverlay.logoAssetPath, "/brand/kick-logo.png");
  assert.equal(plan.kickBrandingOverlay.type, "kick-branding-placeholder");
  assert.match(plan.ffmpeg.argsPreview.join(" "), /fontcolor=black/);
  assert.match(plan.ffmpeg.argsPreview.join(" "), /boxcolor=white@0\.96/);
  assert.match(plan.ffmpeg.argsPreview.join(" "), /drawbox=x=0/);
  assert.match(plan.ffmpeg.argsPreview.join(" "), /KICK\.COM\/ADINROSS/);
});

test("export placeholder supports captions with no background", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    captionText: "No box",
    captionStyle: {
      background: "none",
    },
  });

  const args = plan.ffmpeg.argsPreview.join(" ");
  assert.equal(plan.captionStyle.background, "none");
  assert.match(args, /fontcolor=white/);
  assert.match(args, /borderw=4/);
  assert.doesNotMatch(args, /box=1/);
});

test("person-aware crop keeps a face detected near the left side", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1920, height: 1080 },
    subjectDetections: [
      {
        kind: "face",
        confidence: 0.95,
        box: { x: 120, y: 260, width: 120, height: 120 },
      },
    ],
  });

  assert.equal(plan.selectedCrop.x, 0);
  assert.ok(plan.detectedPrimarySubject);
  assert.ok(plan.faceSafeZone);
});

test("person-aware crop accepts a direct face box input", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1920, height: 1080 },
    faceBox: { x: 118, y: 250, width: 140, height: 140 },
  });

  assert.equal(plan.selectedCrop.x, 0);
  assert.equal(plan.detectedPrimarySubject.kind, "face");
  assert.equal(plan.detectedPrimarySubject.id, "provided-face-box");
  assert.equal(plan.fallbackReason, null);
});

test("person-aware crop accepts a direct head box input", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1920, height: 1080 },
    headBox: { x: 1640, y: 220, width: 150, height: 150 },
  });

  assert.equal(plan.selectedCrop.x, 1312);
  assert.equal(plan.detectedPrimarySubject.kind, "head");
  assert.equal(plan.detectedPrimarySubject.id, "provided-head-box");
  assert.equal(plan.fallbackReason, null);
});

test("person-aware crop keeps a face detected near the right side", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1920, height: 1080 },
    subjectDetections: [
      {
        kind: "face",
        confidence: 0.95,
        box: { x: 1680, y: 260, width: 120, height: 120 },
      },
    ],
  });

  assert.equal(plan.selectedCrop.x, 1312);
  assert.ok(plan.detectedPrimarySubject);
  assert.ok(plan.faceSafeZone);
});

test("person-aware crop keeps a face detected near the top", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1080, height: 2500 },
    subjectDetections: [
      {
        kind: "face",
        confidence: 0.95,
        box: { x: 440, y: 50, width: 180, height: 180 },
      },
    ],
  });

  assert.equal(plan.selectedCrop.y, 0);
  assert.ok(plan.detectedPrimarySubject);
  assert.equal(plan.fallbackReason, null);
});

test("person-aware crop falls back to center crop when no face or person is detected", () => {
  const plan = createPersonAwareReelPlan({
    source: { width: 1920, height: 1080 },
    subjectDetections: [],
  });

  assert.deepEqual(plan.selectedCrop, { x: 656, y: 0, width: 608, height: 1080 });
  assert.equal(plan.detectedPrimarySubject, null);
  assert.equal(plan.faceSafeZone, null);
  assert.equal(plan.fallbackReason, "no-face-or-person-detected");
});

test("captions do not overlap a detected face box", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1080, height: 1920 },
    captionText: "Do not cover the reaction",
    avoidWatermark: true,
    subjectDetections: [
      {
        kind: "face",
        confidence: 0.99,
        box: { x: 450, y: 1050, width: 180, height: 180 },
      },
    ],
  });
  const faceRect = toPixelRect(plan.faceSafeZone.rect, reelFrame);

  assert.equal(plan.bestCaption.position, CAPTION_POSITIONS.top);
  assert.equal(rectsOverlap(plan.captionRect, faceRect), false);
});

test("captions do not overlap a direct head box safe zone", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1080, height: 1920 },
    captionText: "Keep text off the speaker",
    avoidWatermark: true,
    headBox: { x: 430, y: 1050, width: 220, height: 220 },
  });
  const faceRect = toPixelRect(plan.faceSafeZone.rect, reelFrame);

  assert.equal(plan.detectedPrimarySubject.kind, "head");
  assert.equal(plan.bestCaption.position, CAPTION_POSITIONS.top);
  assert.equal(rectsOverlap(plan.captionRect, faceRect), false);
});

test("renderer normalizes the export payload into FFmpeg crop, scale, and caption args", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Final round clutch",
    avoidWatermark: true,
  });
  const normalized = normalizeRenderPayload(plan);
  const args = buildFfmpegRenderArgs(normalized, "/tmp/source.mp4", "/tmp/rendered.mp4");
  const command = args.join(" ");

  assert.equal(normalized.sourcePath, "uploads/source.mp4");
  assert.equal(normalized.outputPath, "renders/output.mp4");
  assert.match(command, /crop=608:1080:656:0,scale=1080:1920/);
  assert.match(command, /drawtext=text='Final round clutch'/);
  assert.ok(args.includes("-map"));
  assert.ok(args.includes("0:a?"));
  assert.ok(args.includes("libx264"));
  assert.equal(args.at(-1), "/tmp/rendered.mp4");
});

test("renderer replaces a plain ffmpeg executable from export plans", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Use packaged ffmpeg",
    ffmpegPath: "ffmpeg",
  });
  const normalized = normalizeRenderPayload(plan);

  assert.notEqual(normalized.ffmpegPath, "ffmpeg");
  assert.match(normalized.ffmpegPath, /ffmpeg-static/);
});

test("renderer keeps caption burn-in enabled when drawtext is supported", () => {
  const mode = createRenderMode({
    drawtextSupported: true,
    overlaySupported: true,
    imageCaptionOverlaySupported: true,
    captionBurnInSupported: true,
  }, "ffmpeg");

  assert.equal(mode.mode, "caption-burn-in");
  assert.equal(mode.captionMode, "drawtext");
  assert.equal(mode.burnCaptions, true);
  assert.deepEqual(mode.warnings, []);
});

test("renderer uses image overlay caption burn-in when drawtext is missing", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Caption should be burned in",
    avoidWatermark: true,
  });
  const mode = createRenderMode({
    drawtextSupported: false,
    overlaySupported: true,
    imageCaptionOverlaySupported: true,
    captionBurnInSupported: true,
  }, "/opt/homebrew/bin/ffmpeg");
  const args = buildFfmpegRenderArgs(plan, "/tmp/source.mp4", "/tmp/rendered.mp4", {
    captionMode: mode.captionMode,
    captionOverlayPath: "/tmp/caption-overlay.png",
  });
  const command = args.join(" ");

  assert.equal(mode.mode, "caption-image-overlay");
  assert.equal(mode.captionMode, "image-overlay");
  assert.equal(mode.burnCaptions, true);
  assert.deepEqual(mode.warnings, []);
  assert.match(command, /crop=608:1080:656:0,scale=1080:1920/);
  assert.match(command, /overlay=0:0/);
  assert.ok(args.includes("/tmp/caption-overlay.png"));
  assert.doesNotMatch(command, /drawtext/);
});

test("renderer creates SVG caption overlay content for the image overlay mode", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Caption burned in locally",
    captionStyle: { background: "white", fontSize: 52 },
    avoidWatermark: true,
  });
  const svg = buildCaptionOverlaySvg(plan);

  assert.match(svg, /<svg/);
  assert.match(svg, /width="1080"/);
  assert.match(svg, /height="1920"/);
  assert.match(svg, /Caption burned in locally/);
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /rx="24"/);
  assert.match(svg, /filter="url\(#captionBubbleShadow\)"/);
  assert.match(svg, /stdDeviation="12"/);
  assert.match(svg, /flood-opacity="0\.12"/);
  assert.match(svg, /@font-face/);
  assert.match(svg, /KickClipperOverlay/);
  assert.match(svg, /data:font\/ttf;base64/);
  assert.doesNotMatch(svg, /Arial Rounded MT Bold|Arial Black|Impact|Helvetica/);
});

test("renderer uses Twemoji image assets for the acceptance caption emojis", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Chat went wild for this moment 😂😭😤🔥💀🙏",
    captionStyle: { background: "white", fontSize: 52 },
    kickBranding: { enabled: false },
    avoidWatermark: true,
  });
  const logs = captureConsoleInfo(() => {
    const svg = buildRenderOverlaySvg(plan);

    assert.match(svg, /data:image\/svg\+xml;base64/);
    assert.equal(svg.match(/<image href="data:image\/svg\+xml;base64/g)?.length, 6);
    assert.doesNotMatch(svg, /😂|😭|😤|🔥|💀|🙏/);
  });

  assert.match(logs, /Found emoji 😂\nUnicode: U\+1F602\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f602\.svg/);
  assert.match(logs, /Found emoji 😭\nUnicode: U\+1F62D\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f62d\.svg/);
  assert.match(logs, /Found emoji 😤\nUnicode: U\+1F624\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f624\.svg/);
  assert.match(logs, /Found emoji 🔥\nUnicode: U\+1F525\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f525\.svg/);
  assert.match(logs, /Found emoji 💀\nUnicode: U\+1F480\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f480\.svg/);
  assert.match(logs, /Found emoji 🙏\nUnicode: U\+1F64F\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f64f\.svg/);
  assert.doesNotMatch(logs, /Asset lookup failed/);
});

test("renderer normalizes variation selectors, skin tones, and ZWJ emoji sequences", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Unicode check ❤️ 👋🏽 👨‍👩‍👧‍👦",
    captionStyle: { background: "white", fontSize: 52 },
    kickBranding: { enabled: false },
    avoidWatermark: true,
  });
  const logs = captureConsoleInfo(() => {
    const svg = buildRenderOverlaySvg(plan);

    assert.equal(svg.match(/<image href="data:image\/svg\+xml;base64/g)?.length, 3);
    assert.doesNotMatch(svg, /❤️|👋🏽|👨‍👩‍👧‍👦/);
  });

  assert.match(logs, /Unicode: U\+2764\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/2764\.svg/);
  assert.match(logs, /Unicode: U\+1F44B U\+1F3FD\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f44b-1f3fd\.svg/);
  assert.match(logs, /Unicode: U\+1F468 U\+200D U\+1F469 U\+200D U\+1F467 U\+200D U\+1F466\nAsset: node_modules\/@discordapp\/twemoji\/dist\/svg\/1f468-200d-1f469-200d-1f467-200d-1f466\.svg/);
});

test("renderer falls back to native emoji text when a parsed Twemoji asset is missing", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "New sequence 🙂‍↔️",
    captionStyle: { background: "white", fontSize: 52 },
    kickBranding: { enabled: false },
    avoidWatermark: true,
  });
  const originalAssetDir = process.env.TWEMOJI_ASSET_DIR;
  process.env.TWEMOJI_ASSET_DIR = "/tmp/kick-clipper-missing-twemoji-assets";
  const logs = captureConsoleInfo(() => {
    try {
      const svg = buildRenderOverlaySvg(plan);

      assert.match(svg, /font-family="KickClipperOverlay"/);
      assert.match(svg, /🙂‍↔️/);
      assert.doesNotMatch(svg, /data:image\/svg\+xml;base64/);
    } finally {
      if (originalAssetDir === undefined) {
        delete process.env.TWEMOJI_ASSET_DIR;
      } else {
        process.env.TWEMOJI_ASSET_DIR = originalAssetDir;
      }
    }
  });

  assert.match(logs, /Found emoji 🙂‍↔️\nUnicode: U\+1F642 U\+200D U\+2194 U\+FE0F\nAsset lookup failed: 1f642-200d-2194-fe0f\.svg/);
});

test("renderer includes Kick watermark bar when enabled", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Caption with Kick link",
    kickBranding: { enabled: true, link: "kick.com/clavicular" },
    avoidWatermark: true,
  });
  const svg = buildRenderOverlaySvg(plan);

  assert.equal(plan.kickBranding.enabled, true);
  assert.match(svg, /KICK\.COM\/CLAVICULAR/);
  assert.match(svg, /data:image\/png;base64/);
  assert.doesNotMatch(svg, />KICK</);
});

test("renderer omits Kick watermark bar when disabled", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Caption without Kick link",
    kickBranding: { enabled: false, link: "kick.com/clavicular" },
    avoidWatermark: true,
  });
  const svg = buildRenderOverlaySvg(plan);

  assert.equal(plan.kickBranding.enabled, false);
  assert.doesNotMatch(svg, /KICK\.COM\/CLAVICULAR/);
  assert.doesNotMatch(svg, /data:image\/png;base64/);
});

test("renderer uses custom Kick link text in the watermark bar", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Custom creator link",
    kickBranding: { enabled: true, link: "https://www.kick.com/adinross/" },
    avoidWatermark: true,
  });
  const svg = buildRenderOverlaySvg(plan);

  assert.equal(plan.kickBranding.link, "kick.com/adinross");
  assert.match(svg, /KICK\.COM\/ADINROSS/);
});

test("renderer uses bundled font for lower-safe caption and Kick link SVG text", () => {
  const plan = createKickClipExportPlan({
    source: { width: 720, height: 1280 },
    sourcePath: "uploads/silky.mp4",
    outputPath: "renders/silky.mp4",
    captionText: "Lower heading stays readable 😂",
    captionPosition: CAPTION_POSITIONS.lowerSafe,
    kickBranding: { enabled: true, link: "kick.com/clavicular" },
    avoidWatermark: false,
  });
  const svg = buildRenderOverlaySvg(plan);
  const textTags = svg.match(/<text\b[^>]*>/g) ?? [];

  assert.ok(textTags.length >= 2);
  assert.match(svg, />Lower heading stays</);
  assert.match(svg, />readable /);
  assert.match(svg, /KICK\.COM\/CLAVICULAR/);
  assert.match(svg, /font-size="39" font-weight="900"/);
  assert.deepEqual(
    textTags.map((tag) => /font-family="KickClipperOverlay"/.test(tag)),
    textTags.map(() => true),
  );
  assert.doesNotMatch(svg, /Arial Rounded MT Bold|Arial Black|Impact|Helvetica|Segoe UI Emoji|Noto Color Emoji|EmojiSymbols/);
});

test("production overlay SVG path removes text nodes before raster text compositing", () => {
  const plan = createKickClipExportPlan({
    source: { width: 720, height: 1280 },
    sourcePath: "uploads/silky.mp4",
    outputPath: "renders/silky.mp4",
    captionText: "Lower heading stays readable",
    captionPosition: CAPTION_POSITIONS.lowerSafe,
    kickBranding: { enabled: true, link: "kick.com/clavicular" },
    avoidWatermark: false,
  });
  const debugSvg = buildRenderOverlaySvg(plan);
  const productionBaseSvg = buildRenderOverlaySvg(plan, { includeText: false });

  assert.match(debugSvg, />Lower heading stays</);
  assert.match(debugSvg, /KICK\.COM\/CLAVICULAR/);
  assert.equal(productionBaseSvg.match(/<text\b/g), null);
  assert.match(productionBaseSvg, /data:image\/png;base64/);
  assert.match(productionBaseSvg, /<image\b/);
});

test("Kick watermark bar does not overlap lower-safe captions", () => {
  const plan = createKickClipExportPlan({
    source: { width: 1920, height: 1080 },
    sourcePath: "uploads/source.mp4",
    outputPath: "renders/output.mp4",
    captionText: "Lower safe caption",
    captionPosition: CAPTION_POSITIONS.lowerSafe,
    kickBranding: { enabled: true, link: "kick.com/clavicular" },
    avoidWatermark: true,
  });
  const kickRect = getKickBrandingRect(plan);

  assert.equal(rectsOverlap(plan.captionRect, kickRect), false);
  assert.ok(kickRect.y > plan.captionRect.y + plan.captionRect.height);
});

test("renderer reports caption unavailable only when no text or overlay filter exists", () => {
  const mode = createRenderMode({
    drawtextSupported: false,
    overlaySupported: false,
    imageCaptionOverlaySupported: false,
    captionBurnInSupported: false,
  }, "ffmpeg");

  assert.equal(mode.mode, "caption-render-unavailable");
  assert.equal(mode.captionMode, "none");
  assert.equal(mode.burnCaptions, false);
  assert.match(mode.warnings[0], /cannot draw or overlay captions/);
});

test("renderer rejects payloads without a source path or selected crop", () => {
  assert.throws(
    () => normalizeRenderPayload({ captionText: "Missing source", captionRect: { x: 0, y: 0, width: 100, height: 80 } }),
    RenderValidationError,
  );

  assert.throws(
    () =>
      normalizeRenderPayload({
        sourcePath: "uploads/source.mp4",
        captionText: "Missing crop",
        captionRect: { x: 0, y: 0, width: 100, height: 80 },
      }),
    RenderValidationError,
  );
});

test("renderer builds job status patches for processing, complete, and failed states", () => {
  const processing = buildJobStatusPatch("processing");
  const complete = buildJobStatusPatch("complete");
  const failed = buildJobStatusPatch("failed", "FFmpeg exited");

  assert.equal(processing.status, "processing");
  assert.match(processing.started_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(processing.error_message, null);
  assert.equal(complete.status, "complete");
  assert.match(complete.completed_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_message, "FFmpeg exited");
  assert.match(failed.completed_at, /^\d{4}-\d{2}-\d{2}T/);
});

function captureConsoleInfo(callback) {
  const originalInfo = console.info;
  const messages = [];

  console.info = (...args) => {
    messages.push(args.join(" "));
  };

  try {
    callback();
  } finally {
    console.info = originalInfo;
  }

  return messages.join("\n");
}
