# Backend Notes

## Current integrated backend

- The app uses Next API routes.
- Supabase server client helper lives at `src/lib/supabase/server.ts`.
- Upload endpoint: `POST /api/upload`.
- Job status endpoint: `GET /api/jobs/:jobId`.
- Job update endpoint: `PATCH /api/jobs/:jobId`.
- Export payload endpoint: `POST /api/export-plan`.

`POST /api/export-plan` uses the shared video utilities to return a planned 9:16 crop/scale operation, selected primary subject, face safe zone, selected or adjusted caption placement, classic TikTok-style caption styling, Kick branding, and FFmpeg argument preview. It accepts uploaded `videoId` and `jobId` values from the frontend and echoes them in the export plan. It does not spawn FFmpeg.

## Required Env Variables

Copy `.env.example` to `.env.local` and fill in:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=videos
MAX_UPLOAD_BYTES=524288000
```

If `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing, upload/job APIs return a clear `503` JSON error. The frontend still supports local preview and export-payload generation without Supabase.

## Database Setup

Apply the migration in:

```bash
supabase/migrations/20260622193000_backend_core.sql
```

The migration creates `users`, `videos`, `processing_jobs`, the `processing_job_status` enum, and the private `videos` storage bucket. No extra database structure was added during video integration.

## Export Plan API Contract

Endpoint:

```http
POST /api/export-plan
Content-Type: application/json
```

Example body:

```json
{
  "source": { "width": 1920, "height": 1080 },
  "videoId": "uuid",
  "jobId": "uuid",
  "sourcePath": "anonymous/source.mp4",
  "outputPath": "kick-clipper-reel.mp4",
  "captionText": "Chat went wild for this moment",
  "captionStyle": {
    "preset": "classic-tiktok",
    "background": "white"
  },
  "kickBranding": {
    "enabled": true,
    "link": "kick.com/clavicular"
  },
  "captionPosition": "custom",
  "customRect": { "x": 760, "y": 1500, "width": 280, "height": 180 },
  "faceBox": { "x": 120, "y": 260, "width": 120, "height": 120 },
  "subjectDetections": [
    {
      "kind": "face",
      "confidence": 0.95,
      "frameTimeMs": 1200,
      "box": { "x": 120, "y": 260, "width": 120, "height": 120 }
    }
  ],
  "avoidWatermark": true
}
```

`faceBox`, `headBox`, and `subjectDetections[].box` are source-video pixel rectangles from sampled frames. Supported `kind` values are `face`, `head`, `upper-body`, and `person`. If no face/head/person input is provided, the response uses a centered crop and sets `fallbackReason`.

The response includes top-level `selectedCrop`, `detectedPrimarySubject`, `faceSafeZone`, `captionRect`, `captionStyle`, `kickBranding`, `kickBrandingOverlay`, and `fallbackReason`. If a requested custom position overlaps a reserved Kick watermark/UI zone or face safe zone and `avoidWatermark` is enabled, the response moves the caption to the safest built-in position and marks `requestedCaption.adjustedForSafety`.

## Upload API Contract

Endpoint:

```http
POST /api/upload
Content-Type: multipart/form-data
```

Fields:

- `file`: required video file.
- `user_id`: optional UUID placeholder until auth is connected.

The upload route stores the file in Supabase Storage, creates a `videos` row, and creates a `processing_jobs` row with status `uploaded`.

## Remaining backend work

- Add the real FFmpeg worker that consumes export plans.
- Replace placeholder Kick bar filters with exact logo/font assets in the real renderer.
- Replace `detectSubjectBoxesPlaceholder()` with MediaPipe/OpenCV/Roboflow frame sampling.
- Store rendered output paths once export is implemented.
- Poll or subscribe to `processing_jobs` for frontend progress.
