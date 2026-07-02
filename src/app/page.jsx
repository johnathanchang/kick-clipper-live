"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CAPTION_POSITIONS,
  INSTAGRAM_REEL_FORMAT,
  WATERMARK_CORNERS,
  createKickClipExportPlan,
  getRecommendedCaptionPositions,
} from "../video/index.js";

const DEFAULT_CAPTION = "Chat went wild for this moment";
const DEFAULT_KICK_LINK = "kick.com/clavicular";
const DEFAULT_SOURCE = { width: 1920, height: 1080 };
const DEFAULT_CUSTOM_RECT = {
  x: 120,
  y: 720,
  width: 840,
  height: 260,
};
const CAPTION_BOX = { widthRatio: 0.84, heightRatio: 0.14 };
const CAPTION_STYLE = {
  classicTikTok: "classic-tiktok",
};
const CAPTION_BACKGROUNDS = {
  white: "white",
  black: "black",
  none: "none",
};
const KICK_LINK_FONT_RATIO = 0.3;
const POPULAR_CAPTION_EMOJIS = ["😭", "😂", "😳", "💀", "❤️", "👀"];
const GITHUB_URL = "https://github.com/johnathanchang/kick-clipper-live";
const FEEDBACK_EMAIL = "mailto:johnathanchang7@gmail.com";

export default function HomePage() {
  const router = useRouter();
  const [step, setStep] = useState("upload");
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [sourceDimensions, setSourceDimensions] = useState(null);
  const [captionText, setCaptionText] = useState(DEFAULT_CAPTION);
  const [fontSize, setFontSize] = useState(42);
  const [captionBackground, setCaptionBackground] = useState(CAPTION_BACKGROUNDS.white);
  const [kickBrandingEnabled, setKickBrandingEnabled] = useState(true);
  const [kickLink, setKickLink] = useState(DEFAULT_KICK_LINK);
  const [position, setPosition] = useState(CAPTION_POSITIONS.lowerSafe);
  const [customRect, setCustomRect] = useState(DEFAULT_CUSTOM_RECT);
  const [avoidWatermark] = useState(true);
  const [uploadState, setUploadState] = useState({ status: "idle" });
  const [jobState, setJobState] = useState({ status: "idle" });
  const [serverExportState, setServerExportState] = useState({ status: "idle" });
  const [renderState, setRenderState] = useState({ status: "idle" });
  const [isNavigating, setIsNavigating] = useState(false);
  const exportStartedRef = useRef(false);
  const navigationLockRef = useRef(false);

  useEffect(() => {
    if (!videoFile) {
      setVideoUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(videoFile);
    setVideoUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [videoFile]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);

  useEffect(() => {
    const jobId = uploadState.result?.jobId;

    if (!jobId) {
      setJobState(uploadState.status === "local-only" ? { status: "local-only" } : { status: "idle" });
      return undefined;
    }

    let cancelled = false;

    async function pollJob() {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Could not load processing job.");
        }

        if (!cancelled) {
          setJobState({ status: "synced", job: data.job });
        }
      } catch (error) {
        if (!cancelled) {
          setJobState({
            status: "failed",
            error: error instanceof Error ? error.message : "Could not load processing job.",
          });
        }
      }
    }

    setJobState({ status: "polling" });
    pollJob();
    const intervalId = window.setInterval(pollJob, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [uploadState]);

  const exportInput = useMemo(
    () => ({
      source: sourceDimensions ?? DEFAULT_SOURCE,
      sourcePath: uploadState.result?.storagePath ?? videoFile?.name ?? "local-preview.mp4",
      outputPath: "kick-clipper-reel.mp4",
      videoId: uploadState.result?.videoId,
      jobId: uploadState.result?.jobId,
      captionText,
      captionStyle: {
        preset: CAPTION_STYLE.classicTikTok,
        background: captionBackground,
        fontSize,
      },
      kickBranding: {
        enabled: kickBrandingEnabled,
        link: normalizeKickLink(kickLink),
      },
      captionPosition: position,
      customRect: position === CAPTION_POSITIONS.custom ? customRect : undefined,
      avoidWatermark,
      watermarkCorner: WATERMARK_CORNERS.unknown,
      captionBox: CAPTION_BOX,
    }),
    [
      avoidWatermark,
      captionBackground,
      captionText,
      customRect,
      fontSize,
      kickLink,
      kickBrandingEnabled,
      position,
      sourceDimensions,
      uploadState,
      videoFile,
    ],
  );

  const localExportPlan = useMemo(
    () => createKickClipExportPlan(exportInput),
    [exportInput],
  );

  async function handleVideoUpload(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setVideoFile(file);
    setSourceDimensions(null);
    setStep("editor");
    exportStartedRef.current = false;
    setUploadState({ status: "uploading" });
    setServerExportState({ status: "idle" });
    setRenderState({ status: "idle" });

    try {
      const data = await uploadVideoFile(file);
      setUploadState({ status: "uploaded", result: data });
    } catch (error) {
      setUploadState({
        status: "local-only",
        error: error instanceof Error ? error.message : "Upload failed.",
      });
    }
  }

  async function createServerExportPlan() {
    setServerExportState({ status: "planning" });
    setRenderState({ status: "idle" });

    try {
      const response = await fetch("/api/export-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportInput),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Clip preparation failed.");
      }

      setServerExportState({ status: "planned", result: data.exportPlan });
      return data.exportPlan;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clip preparation failed.";
      setServerExportState({
        status: "failed",
        error: message,
      });
      setRenderState({
        status: "failed",
        error: message,
      });
      throw error;
    }
  }

  async function renderClip(exportPlan) {
    setRenderState({ status: "rendering" });

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportPlan }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Clip preparation failed.");
      }

      setRenderState({ status: "complete", result: data });
      return data;
    } catch (error) {
      setRenderState({
        status: "failed",
        error: error instanceof Error ? error.message : "Clip preparation failed.",
      });
      throw error;
    }
  }

  async function prepareClipForDownload() {
    try {
      const exportPlan = await createServerExportPlan();
      await renderClip(exportPlan);
    } catch {
      // The visible error state is set by the failed step above.
    }
  }

  function runNavigation(action) {
    if (navigationLockRef.current) {
      return;
    }

    navigationLockRef.current = true;
    setIsNavigating(true);

    window.setTimeout(() => {
      action();

      window.setTimeout(() => {
        navigationLockRef.current = false;
        setIsNavigating(false);
      }, 260);
    }, 90);
  }

  function handleOpenExport() {
    runNavigation(() => {
      exportStartedRef.current = false;
      setServerExportState({ status: "idle" });
      setRenderState({ status: "idle" });
      setStep("export");
    });
  }

  function handleBackToEditor() {
    runNavigation(() => {
      setStep("editor");
    });
  }

  function handleNewClip() {
    runNavigation(() => {
      exportStartedRef.current = false;
      setVideoFile(null);
      setVideoUrl("");
      setSourceDimensions(null);
      setCaptionText(DEFAULT_CAPTION);
      setFontSize(42);
      setCaptionBackground(CAPTION_BACKGROUNDS.white);
      setKickBrandingEnabled(true);
      setKickLink(DEFAULT_KICK_LINK);
      setPosition(CAPTION_POSITIONS.lowerSafe);
      setCustomRect({ ...DEFAULT_CUSTOM_RECT });
      setUploadState({ status: "idle" });
      setJobState({ status: "idle" });
      setServerExportState({ status: "idle" });
      setRenderState({ status: "idle" });
      setStep("upload");
      router.push("/");
    });
  }

  useEffect(() => {
    if (step !== "export") {
      exportStartedRef.current = false;
      return;
    }

    if (renderState.status !== "idle") {
      return;
    }

    if (uploadState.status === "uploading") {
      return;
    }

    if (uploadState.status !== "uploaded") {
      setRenderState({
        status: "failed",
        error: "Upload your clip before downloading the final version.",
      });
      return;
    }

    if (exportStartedRef.current) {
      return;
    }

    exportStartedRef.current = true;
    prepareClipForDownload();
  }, [step, renderState.status, uploadState.status]);
  return (
    <div className={`app-shell ${step === "export" ? "app-shell-export" : ""}`}>
      <Header />

      <main>
        {step === "upload" && (
          <UploadPage
            jobState={jobState}
            uploadState={uploadState}
            videoFile={videoFile}
            onVideoUpload={handleVideoUpload}
            onContinue={() => setStep("editor")}
          />
        )}

        {step === "editor" && (
          <EditorPage
            captionBackground={captionBackground}
            captionText={captionText}
            customRect={customRect}
            exportPlan={localExportPlan}
            fontSize={fontSize}
            kickBrandingEnabled={kickBrandingEnabled}
            kickLink={kickLink}
            position={position}
            videoFile={videoFile}
            videoUrl={videoUrl}
            onCaptionBackgroundChange={setCaptionBackground}
            onCaptionTextChange={setCaptionText}
            onCustomRectChange={setCustomRect}
            onExport={handleOpenExport}
            onFontSizeChange={setFontSize}
            onKickBrandingEnabledChange={setKickBrandingEnabled}
            onKickLinkChange={setKickLink}
            onPositionChange={setPosition}
            onVideoMetadata={setSourceDimensions}
            isNavigating={isNavigating}
          />
        )}

        {step === "export" && (
          <ExportPage
            isNavigating={isNavigating}
            onBack={handleBackToEditor}
            onNewClip={handleNewClip}
            renderState={renderState}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="top-bar">
      <div>
        <h1 className="brand-title">Kick Clipper</h1>
      </div>
      <nav className="top-nav" aria-label="Primary navigation">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/clips">My Clips</Link>
        <Link href="/features">Features</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/login">Login</Link>
      </nav>
    </header>
  );
}

function Footer() {
  function openGitHub() {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  }

  function openFeedback() {
    window.location.href = FEEDBACK_EMAIL;
  }

  return (
    <footer className="app-footer">
      <nav aria-label="Footer links">
        <button aria-label="Open Kick Clipper GitHub repository" onClick={openGitHub} type="button">
          GitHub
        </button>
        <button aria-label="Send feedback by email" onClick={openFeedback} type="button">
          Feedback
        </button>
      </nav>
    </footer>
  );
}

function UploadPage({ jobState, uploadState, videoFile, onVideoUpload, onContinue }) {
  function scrollToFeatures() {
    document.getElementById("viral-features")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <>
      <section className="upload-layout page-transition">
        <div className="upload-copy">
          <h2>Upload your videos and create viral clips in seconds.</h2>
          <p>
            Upload your videos or directly from a Kick stream. Kick Clipper takes
            the most viral moments and turns them into edited clips eligible to be
            paid out on clipping platforms.
          </p>
          <div className="upload-copy-actions">
            <button className="secondary-button" onClick={scrollToFeatures} type="button">
              Explore viral features
            </button>
          </div>
          <p className="clipping-opportunity">
            Looking for clipping opportunities?{" "}
            <a href="https://clipping.net" rel="noreferrer" target="_blank">
              Click here
            </a>
          </p>
        </div>

        <div className="upload-panel">
          <label className="drop-zone">
            <input accept="video/*" onChange={onVideoUpload} type="file" />
            <span className="drop-title">Choose video</span>
            <span className="drop-help">MP4, MOV, or WebM clip</span>
          </label>

          <UploadStatus uploadState={uploadState} />
          <JobStatus jobState={jobState} />

          {videoFile && (
            <div className="file-ready">
              <div>
                <p>{videoFile.name}</p>
                <span>{formatFileSize(videoFile.size)}</span>
              </div>
              <button className="primary-button" onClick={onContinue} type="button">
                Open editor
              </button>
            </div>
          )}
        </div>
      </section>

      <FeaturesSection />
      <p className="beta-pricing-note">
        Join during beta for $15/month, and you’ll keep that price for as long as your subscription stays active.
      </p>
    </>
  );
}

function FeaturesSection() {
  const features = [
    {
      title: "Viral caption styling",
      body: "Bold TikTok-style captions, emoji support, and background options make the clip readable in a fast scroll.",
    },
    {
      title: "Monetization-ready branding",
      body: "A Kick watermark bar keeps the creator link visible while the exported reel stays ready for clipping workflows.",
    },
    {
      title: "9:16 reel exports",
      body: "Wide videos are converted into vertical reels with crop planning built for TikTok, Shorts, and Reels.",
    },
    {
      title: "Safe-zone placement",
      body: "Caption positions are designed to avoid the lower UI, watermark areas, and other zones that can hurt retention.",
    },
    {
      title: "Fast edit-to-export loop",
      body: "Preview, adjust captions, move custom text, export, go back to edit, or start a new clip without rebuilding the session.",
    },
    {
      title: "Rendered final clips",
      body: "The export flow burns in captions, emoji, crop, and branding so the downloaded file is ready to post.",
    },
  ];

  return (
    <section className="features-section" id="viral-features">
      <div className="features-heading">
        <span className="eyebrow">Viral clip engine</span>
        <h2>Built to turn Kick moments into monetizable reels.</h2>
        <p>
          Kick Clipper focuses the whole workflow on retention, readability, and
          platform-ready exports so clippers can move from raw stream moments to
          polished vertical clips quickly.
        </p>
      </div>

      <div className="features-grid">
        {features.map((feature) => (
          <article className="feature-card" key={feature.title}>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function EditorPage({
  captionBackground,
  captionText,
  customRect,
  exportPlan,
  fontSize,
  kickBrandingEnabled,
  kickLink,
  position,
  videoFile,
  videoUrl,
  onCaptionBackgroundChange,
  onCaptionTextChange,
  onCustomRectChange,
  onExport,
  onFontSizeChange,
  onKickBrandingEnabledChange,
  onKickLinkChange,
  onPositionChange,
  onVideoMetadata,
  isNavigating,
}) {
  return (
    <section className="editor-layout page-transition">
      <div className="preview-panel">
        <div className="preview-stage">
          <div className="video-frame">
            {videoFile && videoUrl ? (
              <video
                controls
                onLoadedMetadata={(event) => {
                  onVideoMetadata({
                    width: event.currentTarget.videoWidth || DEFAULT_SOURCE.width,
                    height: event.currentTarget.videoHeight || DEFAULT_SOURCE.height,
                  });
                }}
                src={videoUrl}
              />
            ) : !videoFile ? (
              <div className="empty-preview">
                <p>No video selected</p>
                <span>Upload a clip to see the preview.</span>
              </div>
            ) : null}

            {videoFile && (
              <>
                <CaptionOverlay
                  background={captionBackground}
                  captionText={captionText}
                  fontSize={fontSize}
                  isDraggable={position === CAPTION_POSITIONS.custom}
                  onRectChange={onCustomRectChange}
                  rect={exportPlan.captionRenderPlan.rect}
                />
                <KickWatermarkOverlay exportPlan={exportPlan} />
              </>
            )}
          </div>
        </div>

        <div className="preview-footer">
          <button className="primary-button" disabled={!videoFile || isNavigating} onClick={onExport} type="button">
            <img alt="" aria-hidden="true" className="button-icon" src="/assets/download-icon.png" />
            <span>Export clip</span>
          </button>
        </div>
      </div>

      <CaptionSettingsPanel
        captionBackground={captionBackground}
        captionText={captionText}
        fontSize={fontSize}
        kickBrandingEnabled={kickBrandingEnabled}
        kickLink={kickLink}
        position={position}
        onCaptionBackgroundChange={onCaptionBackgroundChange}
        onCaptionTextChange={onCaptionTextChange}
        onFontSizeChange={onFontSizeChange}
        onKickBrandingEnabledChange={onKickBrandingEnabledChange}
        onKickLinkChange={onKickLinkChange}
        onPositionChange={onPositionChange}
      />
    </section>
  );
}

function SafeZoneOverlay({ safeZones }) {
  return (
    <div className="safe-zone-layer" aria-hidden="true">
      {safeZones.map((zone) => (
        <div
          className={`safe-zone safe-zone-${zone.severity}`}
          key={zone.id}
          style={rectToPercentStyle(zone.rect, true)}
          title={zone.reason}
        >
          <span>{zone.label}</span>
        </div>
      ))}
    </div>
  );
}

function CaptionOverlay({
  background,
  captionText,
  fontSize,
  isDraggable = false,
  onRectChange,
  rect,
}) {
  function handlePointerDown(event) {
    if (!isDraggable || !onRectChange) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const overlay = event.currentTarget;
    const frame = overlay.parentElement;
    const frameBounds = frame.getBoundingClientRect();
    const pointerStart = getReelPoint(event, frameBounds);
    const dragOffset = {
      x: pointerStart.x - rect.x,
      y: pointerStart.y - rect.y,
    };

    function handlePointerMove(moveEvent) {
      const pointer = getReelPoint(moveEvent, frameBounds);

      onRectChange({
        ...rect,
        x: clamp(Math.round(pointer.x - dragOffset.x), 0, INSTAGRAM_REEL_FORMAT.width - rect.width),
        y: clamp(Math.round(pointer.y - dragOffset.y), 0, INSTAGRAM_REEL_FORMAT.height - rect.height),
      });
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  return (
    <div
      className={`caption-overlay caption-style-${background} ${
        isDraggable ? "caption-draggable" : ""
      }`}
      onPointerDown={handlePointerDown}
      style={{
        ...rectToPercentStyle(rect),
        "--caption-font-ratio": fontSize / INSTAGRAM_REEL_FORMAT.width,
      }}
    >
      <span>{captionText || "Add your caption"}</span>
    </div>
  );
}

function KickWatermarkOverlay({ exportPlan }) {
  const branding = exportPlan.kickBranding;
  const overlay = exportPlan.kickBrandingOverlay;
  const rect = exportPlan.kickBrandingRect ?? overlay?.rect;

  if (!branding?.enabled || !overlay?.logoAssetPath || !rect) {
    return null;
  }

  return (
    <div
      aria-label="Kick watermark preview"
      className="kick-watermark-overlay"
      style={{
        ...rectToPercentStyle(rect),
        "--kick-link-font-ratio": (rect.height * KICK_LINK_FONT_RATIO) / INSTAGRAM_REEL_FORMAT.width,
      }}
    >
      <img alt="" aria-hidden="true" className="kick-watermark-logo" src={overlay.logoAssetPath} />
      <span className="kick-watermark-link">{branding.link.toUpperCase()}</span>
    </div>
  );
}

function CaptionSettingsPanel({
  captionBackground,
  captionText,
  fontSize,
  kickBrandingEnabled,
  kickLink,
  position,
  onCaptionBackgroundChange,
  onCaptionTextChange,
  onFontSizeChange,
  onKickBrandingEnabledChange,
  onKickLinkChange,
  onPositionChange,
}) {
  const positions = getRecommendedCaptionPositions();

  return (
    <aside className="settings-panel">
      <div>
        <h2 className="settings-title">Clipping Settings</h2>
      </div>

      <label className="field-group">
        <span>Caption text</span>
        <textarea
          onChange={(event) => onCaptionTextChange(event.target.value)}
          rows="4"
          value={captionText}
        />
      </label>

      <div className="field-group popular-emojis">
        <span>Popular emojis</span>
        <div className="emoji-row" aria-label="Popular caption emojis">
          {POPULAR_CAPTION_EMOJIS.map((emoji) => (
            <button
              aria-label={`Add ${emoji} to caption`}
              key={emoji}
              onClick={() => onCaptionTextChange(appendEmoji(captionText, emoji))}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <label className="field-group">
        <span>Font size</span>
        <input
          max="72"
          min="24"
          onChange={(event) => onFontSizeChange(Number(event.target.value))}
          type="range"
          value={fontSize}
        />
        <strong>{fontSize}px</strong>
      </label>

      <fieldset className="field-group">
        <legend>Caption background</legend>
        <div className="segmented-control">
          {[
            [CAPTION_BACKGROUNDS.white, "White"],
            [CAPTION_BACKGROUNDS.black, "Black"],
            [CAPTION_BACKGROUNDS.none, "None"],
          ].map(([value, label]) => (
            <button
              className={captionBackground === value ? "selected" : ""}
              key={value}
              onClick={() => onCaptionBackgroundChange(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="toggle-row">
        <input
          checked={kickBrandingEnabled}
          onChange={(event) => onKickBrandingEnabledChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Add Kick watermark bar</strong>
          <small>Show or discard the lower Kick logo/link bar.</small>
        </span>
      </label>

      {kickBrandingEnabled && (
        <label className="field-group">
          <span>Kick link</span>
          <input
            className="text-input"
            onChange={(event) => onKickLinkChange(event.target.value)}
            placeholder="kick.com/clavicular"
            type="text"
            value={kickLink}
          />
        </label>
      )}

      <fieldset className="field-group">
        <legend>Position</legend>
        <div className="segmented-control">
          {positions.map((option) => (
            <button
              className={position === option.id ? "selected" : ""}
              key={option.id}
              onClick={() => onPositionChange(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {position === CAPTION_POSITIONS.custom && (
        <div className="drag-hint">Drag the caption directly on the Reel preview.</div>
      )}
    </aside>
  );
}

function ExportPage({ isNavigating, onBack, onNewClip, renderState }) {
  const signedUrl = renderState.result?.signedUrl;
  const isComplete = renderState.status === "complete" && signedUrl;
  const hasFailed = renderState.status === "failed";

  function handleDownload() {
    if (!signedUrl) {
      return;
    }

    const link = document.createElement("a");
    link.href = signedUrl;
    link.download = renderState.result?.outputPath || "kick-clipper-reel.mp4";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <section className="export-page page-transition">
      <div className="export-layout final-export-layout">
        <div className="final-preview-panel">
          <div className="preview-stage">
            <div className="video-frame final-video-frame">
              {isComplete ? (
                <video autoPlay loop muted playsInline src={signedUrl} />
              ) : (
                <div className="empty-preview">
                  <p>{hasFailed ? "Preview unavailable" : "Preparing preview"}</p>
                  <span>{hasFailed ? "Please try exporting the clip again." : "Your finished clip will appear here."}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="success-panel">
          <div className={`success-icon ${hasFailed ? "success-icon-failed" : ""}`}>
            {hasFailed ? "!" : "✓"}
          </div>
          <h2>{isComplete ? "Your clip is ready!" : hasFailed ? "Clip needs another try" : "Preparing your clip..."}</h2>
          {!isComplete && (
            <p>
              {hasFailed
                ? renderState.error || "Something went wrong while finishing your clip."
                : "Finishing your edits now."}
            </p>
          )}
          <div className="success-actions">
            <button className="primary-button download-clip-button" disabled={!isComplete} onClick={handleDownload} type="button">
              <img alt="" aria-hidden="true" className="button-icon" src="/assets/download-icon.png" />
              <span>Download Clip</span>
            </button>
            <button className="secondary-button back-button" disabled={isNavigating} onClick={onBack} type="button">
              <span aria-hidden="true">←</span>
              <span>Back to Editor</span>
            </button>
            <button className="secondary-button new-clip-button" disabled={isNavigating} onClick={onNewClip} type="button">
              <span>New Clip</span>
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function UploadStatus({ uploadState, compact = false }) {
  if (uploadState.status === "idle") {
    return null;
  }

  const message = describeUpload(uploadState);

  return (
    <div className={`upload-status upload-status-${uploadState.status} ${compact ? "compact" : ""}`}>
      {uploadState.status === "uploading" && <span className="spinner" />}
      <span>{message}</span>
    </div>
  );
}

function JobStatus({ jobState, compact = false }) {
  if (jobState.status === "idle" || jobState.status === "local-only") {
    return null;
  }

  return (
    <div className={`upload-status upload-status-${jobState.status} ${compact ? "compact" : ""}`}>
      {jobState.status === "polling" && <span className="spinner" />}
      <span>{describeJob(jobState)}</span>
    </div>
  );
}

function buildPlacementSummary(exportPlan) {
  const requested = exportPlan.requestedCaption;
  const position = requested.adjustedForSafety
    ? `${requested.requestedPosition} moved to ${requested.position}`
    : requested.position;

  return `${position}; ${requested.risk.overlaps.length} safe-zone overlaps`;
}

function describeUpload(uploadState) {
  if (uploadState.status === "uploading") return "Uploading clip...";
  if (uploadState.status === "uploaded") return "Upload complete";
  if (uploadState.status === "local-only") return `Local preview only: ${uploadState.error}`;
  return "Not uploaded yet";
}

async function uploadVideoFile(file) {
  try {
    return await uploadVideoWithSignedUrl(file);
  } catch (signedUploadError) {
    console.warn("Signed upload failed; falling back to /api/upload.", signedUploadError);
    return uploadVideoWithMultipartFallback(file);
  }
}

async function uploadVideoWithSignedUrl(file) {
  const uploadUrlResponse = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });
  const uploadUrlData = await readJsonResponse(uploadUrlResponse);

  if (!uploadUrlResponse.ok) {
    throw new Error(getApiErrorMessage(uploadUrlData) || "Could not create a signed upload URL.");
  }

  const signedUploadBody = new FormData();
  signedUploadBody.append("cacheControl", "3600");
  signedUploadBody.append("", file);

  const storageUploadResponse = await fetch(uploadUrlData.signedUrl, {
    method: "PUT",
    headers: {
      "x-upsert": "false",
    },
    body: signedUploadBody,
  });

  if (!storageUploadResponse.ok) {
    throw new Error(`Signed storage upload failed with ${storageUploadResponse.status}.`);
  }

  const completeResponse = await fetch("/api/upload-complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      storagePath: uploadUrlData.storagePath,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  });
  const completeData = await readJsonResponse(completeResponse);

  if (!completeResponse.ok) {
    throw new Error(getApiErrorMessage(completeData) || "Upload completed but job creation failed.");
  }

  return completeData;
}

async function uploadVideoWithMultipartFallback(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });
  const data = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(data) || "Upload failed.");
  }

  return data;
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  if (typeof data.details === "string") return data.details;
  if (Array.isArray(data.details?.missing)) {
    return `${data.error || "Missing environment variables"}: ${data.details.missing.join(", ")}`;
  }
  return "";
}

function describeJob(jobState) {
  if (jobState.status === "polling") return "Checking clip status...";
  if (jobState.status === "failed") return `Clip status unavailable: ${jobState.error}`;
  if (jobState.status === "synced" && jobState.job) {
    if (jobState.job.status === "failed") {
      return `Clip failed: ${jobState.job.error_message || "Unknown error"}`;
    }

    return `Clip ${jobState.job.status}`;
  }

  return "No clip status yet";
}

function normalizeKickLink(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return DEFAULT_KICK_LINK;

  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/g, "");
}

function appendEmoji(text, emoji) {
  const trimmedEnd = String(text || "").trimEnd();
  const endsWithPopularEmoji = POPULAR_CAPTION_EMOJIS.some((popularEmoji) => {
    return trimmedEnd.endsWith(popularEmoji);
  });
  const separator = trimmedEnd && !endsWithPopularEmoji ? " " : "";

  return `${trimmedEnd}${separator}${emoji}`;
}

function getReelPoint(event, frameBounds) {
  return {
    x: ((event.clientX - frameBounds.left) / frameBounds.width) * INSTAGRAM_REEL_FORMAT.width,
    y: ((event.clientY - frameBounds.top) / frameBounds.height) * INSTAGRAM_REEL_FORMAT.height,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function rectToPercentStyle(rect, normalized = false) {
  const x = normalized ? rect.x : rect.x / INSTAGRAM_REEL_FORMAT.width;
  const y = normalized ? rect.y : rect.y / INSTAGRAM_REEL_FORMAT.height;
  const width = normalized ? rect.width : rect.width / INSTAGRAM_REEL_FORMAT.width;
  const height = normalized ? rect.height : rect.height / INSTAGRAM_REEL_FORMAT.height;

  return {
    left: `${x * 100}%`,
    top: `${y * 100}%`,
    width: `${width * 100}%`,
    height: `${height * 100}%`,
  };
}

function formatFileSize(sizeInBytes) {
  if (!sizeInBytes) {
    return "0 MB";
  }

  return `${(sizeInBytes / 1024 / 1024).toFixed(1)} MB`;
}
