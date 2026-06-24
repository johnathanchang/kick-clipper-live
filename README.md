# Kick Clipper Live

Kick Clipper Live is a Next.js app for turning Kick stream moments into captioned vertical clips. The current working build includes emoji captions, caption background styles, custom caption text, a wide Kick attribution bar, Supabase-backed uploads, export-plan generation, and local FFmpeg rendering.

## Requirements

- Node.js 20 or newer
- npm
- FFmpeg available on your `PATH`
- A Supabase project with the `videos` storage bucket and the tables from `supabase/migrations`

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env.local
   ```

3. Fill in `.env.local`:

   ```bash
   SUPABASE_URL=your-supabase-url
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SUPABASE_STORAGE_BUCKET=videos
   MAX_UPLOAD_BYTES=524288000
   ```

4. Run the app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`.

## Scripts

- `npm run dev` starts the Next.js development server.
- `npm run build` creates a production build.
- `npm run start` serves a production build.
- `npm run test` runs the video logic tests.
- `npm run typecheck` runs TypeScript type checks.

## Environment Notes

The server routes use the Supabase service-role key for upload, job, and render operations. Keep `.env.local` private and only commit `.env.example`.

Rendered videos are uploaded back to the configured Supabase storage bucket. Local video files and build output are ignored by Git.
