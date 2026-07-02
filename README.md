# Kick Clipper Live

Kick Clipper Live is a creator SaaS for Kick streamers who want to turn stream moments into captioned vertical clips without covering the Kick watermark, webcam, chat, alerts, or important game UI.

The product is built around a simple streamer pain: generic AI clipping and captioning tools often place text directly over the parts of a stream clip that matter. Kick Clipper focuses on stream-safe caption placement, 9:16 social exports, and a workflow that helps creators move from live moment to post-ready clip faster.

## What It Does

Kick Clipper Live lets a creator upload a stream clip, preview it inside a vertical short-form frame, choose caption placement, protect Kick-specific UI zones, and render a post-ready MP4.

The core promise:

> Caption your Kick clips without covering the watermark or important stream UI.

The app is built for creators posting Kick stream moments to TikTok, YouTube Shorts, Instagram Reels, X, and other short-form platforms.

## Key Features

- **Kick-aware caption placement**: Places captions around reserved watermark and UI zones instead of blindly centering text.
- **9:16 short-form editor**: Previews each clip in a vertical Reel-style frame before export.
- **Safe-zone overlays**: Visualizes areas to avoid, including Kick watermark regions, bottom controls, and subject-safe regions.
- **Caption controls**: Supports top, middle, lower-safe, and custom caption positions.
- **Caption styling**: Includes classic short-form caption treatment with white, black, or transparent backgrounds.
- **Emoji caption support**: Uses Twemoji/emoji assets so creator-native caption text renders cleanly.
- **Kick attribution bar**: Adds a wide Kick-style lower branding bar with editable creator link text.
- **Supabase-backed uploads**: Stores source videos, generated files, and processing job metadata.
- **Export planning API**: Produces crop, caption, safe-zone, branding, and FFmpeg payload data.
- **Local FFmpeg rendering**: Uses packaged FFmpeg support to render processed MP4 exports.

## Tech Stack

- **Framework**: Next.js 15 App Router
- **UI**: React 18, Tailwind/CSS styling
- **Language**: JavaScript and TypeScript
- **Backend**: Next API routes
- **Storage/database**: Supabase
- **Video rendering**: FFmpeg via `ffmpeg-static`
- **Image/text rendering**: Sharp, Twemoji parser, bundled font assets
- **Testing**: Node test runner
- **Deployment target**: Vercel-compatible Next.js app

## Architecture Overview

Kick Clipper Live is organized as a single Next.js app with shared video-planning utilities.

```text
src/
├── app/
│   ├── api/
│   │   ├── export-plan/       # Builds crop, caption, branding, and FFmpeg plan payloads
│   │   ├── jobs/[jobId]/      # Reads and updates processing job state
│   │   ├── render/            # Runs FFmpeg render and uploads output
│   │   ├── upload/            # Direct upload endpoint
│   │   ├── upload-complete/   # Completes signed upload flows
│   │   └── upload-url/        # Creates signed upload URLs
│   ├── layout.jsx             # App shell and metadata
│   └── page.jsx               # Main upload, editor, preview, and export UI
├── lib/supabase/              # Server-side Supabase client helper
├── server/render/             # FFmpeg path and render utilities
└── video/                     # Crop, safe-zone, caption, and export-plan utilities
```

High-level flow:

1. A creator uploads or stages a Kick stream clip.
2. The app stores the source video in Supabase Storage and tracks a processing job.
3. The editor previews the clip in a 9:16 frame with caption, safe-zone, and Kick attribution controls.
4. The export-plan API calculates crop, caption position, safe-zone adjustments, Kick branding, and FFmpeg arguments.
5. The render API downloads the source video, renders the output with FFmpeg, uploads the finished MP4, and returns a signed URL.

## Setup Instructions

### Prerequisites

- Node.js 20 or newer
- npm
- Supabase project
- Supabase CLI for migrations, or access to the Supabase SQL editor

FFmpeg is provided through `ffmpeg-static`. If you prefer to test with a system FFmpeg binary, install it locally:

```bash
brew install ffmpeg
```

### Install Dependencies

```bash
npm install
```

### Configure Environment

Copy the example environment file:

```bash
cp .env.example .env.local
```

Fill in the required Supabase values:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=videos
MAX_UPLOAD_BYTES=524288000
TWEMOJI_ASSET_DIR=
```

## Environment Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Yes for uploads/rendering | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes for uploads/rendering | Server-side Supabase key used by API routes |
| `SUPABASE_STORAGE_BUCKET` | Yes for uploads/rendering | Storage bucket for source and rendered videos, defaults to `videos` |
| `MAX_UPLOAD_BYTES` | Optional | Upload size limit, defaults to `524288000` |
| `TWEMOJI_ASSET_DIR` | Optional | Custom Twemoji asset directory; leave blank to use bundled public assets |

Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code.

## Database Setup

Apply the Supabase migration:

```bash
supabase db push
```

Migration file:

```text
supabase/migrations/20260622193000_backend_core.sql
```

The migration creates the core `users`, `videos`, and `processing_jobs` tables, the `processing_job_status` enum, and the private `videos` storage bucket.

If you are not using the Supabase CLI, run the migration SQL manually in the Supabase SQL editor.

## Local Development

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful checks:

```bash
npm run typecheck
npm test
```

Build locally:

```bash
npm run build
```

The frontend can still run local preview and export-plan generation when Supabase environment variables are missing. Uploads, persisted jobs, and rendering require Supabase configuration.

## Deployment Notes

Kick Clipper Live is designed to deploy as a Next.js app.

Deployment checklist:

- Add all Supabase environment variables to the hosting provider.
- Apply the Supabase migration before accepting uploads.
- Confirm the private `videos` storage bucket exists.
- Confirm the deployment runtime can execute the packaged FFmpeg binary from `ffmpeg-static`.
- Keep uploaded clips private by default.
- Use signed URLs for source uploads and rendered output access.
- Add rate limits, file size limits, and authentication before broad public access.

The current render route is suitable for MVP demos and low-volume beta usage. For production scale, move video rendering into a dedicated background worker queue so long FFmpeg jobs do not depend on web request lifetimes.

## Product Positioning

Kick Clipper Live is aimed at streamers who post clips but do not have a dedicated editor.

Best-fit users:

- Kick streamers posting to TikTok, Shorts, Reels, or X.
- Gaming, IRL, reaction, sports talk, and chat-heavy creators.
- Creators who need the Kick watermark to stay visible.
- Streamers whose webcam, chat, HUD, alerts, or scoreboard are part of the moment.

## Roadmap

- Add real subject detection through MediaPipe, OpenCV, Roboflow, or a similar frame-sampling adapter.
- Move video rendering to a background worker queue.
- Add authentication and creator accounts.
- Add freemium plan enforcement for Free and Pro usage limits.
- Save per-creator caption styles and protected layout presets.
- Add clip history, re-downloads, and rendered output management.
- Improve caption editing controls for sizing, timing, and manual placement.
- Add direct social export presets for TikTok, YouTube Shorts, Instagram Reels, and X.

## Status

Kick Clipper Live currently has an integrated Next.js frontend, Supabase-backed upload and job APIs, shared video-planning utilities, video logic tests, and an FFmpeg render route. The next major product step is hardening the render workflow for production usage and connecting the freemium creator SaaS paywall.
