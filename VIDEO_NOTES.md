# Video Agent Notes

## Framing and safe-zone assumptions

- Kick clips are exported to a vertical Instagram Reel frame at `1080x1920`.
- When face/person boxes are provided, the 9:16 crop shifts to keep the primary face/head/upper body visible and biased toward the upper-middle of the Reel.
- If no face/person boxes are provided, the export plan falls back to the centered 9:16 crop and sets `fallbackReason` to `no-face-or-person-detected`.
- Safe zones are normalized rectangles, so the same rules work for previews, exports, and tests at any frame size.
- The MVP treats Kick watermark/UI risk as a bottom-corner problem. If the exact corner is unknown, both bottom corners are reserved.
- The detected primary subject also becomes a high-risk safe zone, so captions avoid the streamer's face/head/upper body in addition to Kick overlays.
- Captions default to a classic TikTok-style preset: bold rounded type with a white pill, with options for black pill or no background.
- Kick branding is represented as a horizontal black lower bar with green `KICK` logo text and editable `kick.com/...` creator link.
- Bottom playback controls are treated as high-risk, so captions should not sit in the lowest part of the frame.
- `lower-safe` is a raised lower-third position. It still feels like a social caption, but it sits above the bottom controls and modeled watermark zones.
- Real computer vision is still a future adapter. `detectSubjectBoxesPlaceholder()` documents the MediaPipe/OpenCV/Roboflow return shape, and the app can already consume sampled boxes through `subjectDetections`.

## Files changed

- `package.json` now combines the Next app scripts with the dependency-free video test script.
- `src/app/page.jsx` uses these utilities for caption position selection, safe-zone preview, and export payload display.
- `src/app/api/export-plan/route.ts` exposes backend export payload generation using the same utility functions.
- `src/video/reelFormat.js` creates 9:16 Instagram Reel crop/scale plans and FFmpeg filter text.
- `src/video/personFraming.js` selects the primary subject, shifts the 9:16 crop around face/person boxes, creates the face safe zone, and exposes the future CV adapter placeholder.
- `src/video/safeZones.js` defines normalized safe zones, Kick watermark assumptions, and overlap helpers.
- `src/video/captionPositions.js` defines `top`, `middle`, `lower-safe`, and `custom` caption placement logic.
- `src/video/rendering.js` creates renderer-friendly caption payloads and a lightweight FFmpeg `drawtext` placeholder.
- `src/video/exportPlaceholders.js` creates a planned export payload that combines reel conversion, caption placement, caption style, and Kick bar branding.
- `src/video/index.js` re-exports the video helpers for app integration.
- `src/video/index.d.ts` gives the TypeScript API route enough type information to import the JavaScript utilities.
- `test/video.test.js` covers reel conversion, watermark zones, subject-aware crop edges, fallback, lower-safe positioning, and face-aware caption avoidance.

## How frontend should use the functions

The integrated frontend already imports from `src/video/index.js` in `src/app/page.jsx`.

```js
import {
  CAPTION_POSITIONS,
  WATERMARK_CORNERS,
  getBestCaptionPosition,
  getCaptionRect,
  getDefaultSafeZones,
} from "./src/video/index.js";
```

For a 9:16 preview canvas:

```js
const frame = { width: 1080, height: 1920 };
const safeZones = getDefaultSafeZones({
  watermarkCorner: WATERMARK_CORNERS.unknown,
});

const best = getBestCaptionPosition({
  frame,
  avoidWatermark: true,
  safeZones,
});

const captionRect = getCaptionRect(best.position, frame);
```

Frontend can draw `safeZones` as translucent overlay rectangles in preview mode and place the caption using `captionRect`.

When the user chooses a manual placement, use:

```js
const captionRect = getCaptionRect(CAPTION_POSITIONS.custom, frame, {
  customRect: { x: 120, y: 720, width: 840, height: 260 },
});
```

Backend/export uses `createKickClipExportPlan(...)` in `POST /api/export-plan`. It currently returns FFmpeg argument previews instead of spawning FFmpeg, so it is safe for the MVP while leaving the real renderer as the next backend step.

Caption styling can be passed as:

```json
{
  "captionStyle": {
    "preset": "classic-tiktok",
    "background": "white"
  },
  "kickBranding": {
    "enabled": true,
    "link": "kick.com/clavicular"
  }
}
```

Supported caption backgrounds are `white`, `black`, and `none`.

## Subject detection input

`POST /api/export-plan` and `createKickClipExportPlan(...)` accept a direct `faceBox`, direct `headBox`, or sampled detections:

```json
{
  "faceBox": { "x": 120, "y": 260, "width": 120, "height": 120 },
  "subjectDetections": [
    {
      "kind": "face",
      "confidence": 0.95,
      "frameTimeMs": 1200,
      "box": { "x": 120, "y": 260, "width": 120, "height": 120 }
    }
  ]
}
```

Boxes are source-video pixel coordinates before the 9:16 crop. Supported `kind` values are `face`, `head`, `upper-body`, and `person`.
