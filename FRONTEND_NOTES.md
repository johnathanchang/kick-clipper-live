# Frontend Notes

## Current integrated flow

- The frontend now runs inside the shared Next app at `src/app/page.jsx`.
- Upload selects a local video, opens the editor immediately, and attempts `POST /api/upload`.
- Successful uploads store `videoId`, `jobId`, storage bucket, and storage path in frontend state.
- The frontend polls `GET /api/jobs/:jobId` every few seconds and displays the current backend processing status in the editor/export flow.
- If Supabase env vars are missing, the UI keeps the local preview active and shows the upload failure instead of blocking the demo.
- The editor preview is a 9:16 Reel frame and uses `src/video/index.js` for caption rectangles and safe-zone overlays.
- Caption controls are wired to the video utility positions: `top`, `middle`, `lower-safe`, and `custom`.
- Caption styling now uses a classic TikTok-style bold rounded caption treatment with selectable `White`, `Black`, or `None` background.
- The preview includes a horizontal black Kick bar with a green `KICK` logo block and editable creator link such as `kick.com/clavicular`.
- The "avoid Kick watermark" toggle feeds the same export-planning logic used by the backend route.
- The safe-zone preview draws normalized Kick UI/watermark risk zones over the video; when subject boxes are available, export planning also adds a face/person safe zone.
- The export screen shows selected crop, detected subject, face safe zone, caption rect, caption style, Kick branding, fallback reason, and FFmpeg payload, then can request the backend version from `POST /api/export-plan`.
- Export payload generation sends the uploaded `videoId`, `jobId`, and storage path to `POST /api/export-plan`, so generated plans can be traced back to backend records.

## Files changed

- `src/app/page.jsx` contains the upload, editor, safe-zone preview, caption controls, and export payload flow.
- `src/app/globals.css` contains the integrated app styles.
- `src/app/layout.jsx` adds the Next root layout and metadata.
- `src/app/api/export-plan/route.ts` exposes the backend export payload generation endpoint.
- Vite-only files were removed because the merged app is now a Next app.

## Remaining frontend work

- Send sampled `subjectDetections` once the MediaPipe/OpenCV/Roboflow adapter is connected.
- Replace the payload preview with real render progress and download output.
- Add richer custom caption sizing controls if users need manual width/height adjustment.
- Replace the placeholder CSS Kick logo with exact brand artwork if licensing/asset requirements allow it.
