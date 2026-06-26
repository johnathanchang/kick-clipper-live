"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
const CAPTION_BOX = { widthRatio: 0.84, heightRatio: 0.14 };
const CAPTION_STYLE = {
  classicTikTok: "classic-tiktok",
};
const CAPTION_BACKGROUNDS = {
  white: "white",
  black: "black",
  none: "none",
};
const POPULAR_CAPTION_EMOJIS = ["😭", "😂", "😳", "💀", "❤️", "👀"];

export default function HomePage() {
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
  const [customRect, setCustomRect] = useState({
    x: 120,
    y: 720,
    width: 840,
    height: 260,
  });
  const [avoidWatermark] = useState(true);
  const [uploadState, setUploadState] = useState({ status: "idle" });
  const [jobState, setJobState] = useState({ status: "idle" });
  const [serverExportState, setServerExportState] = useState({ status: "idle" });
  const [renderState, setRenderState] = useState({ status: "idle" });
  const exportStartedRef = useRef(false);

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

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed.");
      }

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
            onExport={() => setStep("export")}
            onFontSizeChange={setFontSize}
            onKickBrandingEnabledChange={setKickBrandingEnabled}
            onKickLinkChange={setKickLink}
            onPositionChange={setPosition}
            onVideoMetadata={setSourceDimensions}
          />
        )}

        {step === "export" && (
          <ExportPage
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
    </header>
  );
}

function Footer() {
  return (
    <footer className="app-footer">
      <nav aria-label="Footer links">
        <a href="https://github.com/johnathanchang/kick-clipper-live" rel="noreferrer" target="_blank">
          GitHub
        </a>
        <a href="mailto:johnathanchang7@gmail.com">Feedback</a>
      </nav>
    </footer>
  );
}

function UploadPage({ jobState, uploadState, videoFile, onVideoUpload, onContinue }) {
  return (
    <section className="upload-layout">
      <div className="upload-copy">
        <h2>Upload your clips and edit them in seconds.</h2>
        <p>
          Upload your videos or directly from a Kick stream. Kick Clipper takes
          the most viral moments and turns them into edited clips eligible to be
          paid out on clipping platforms.
        </p>
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
}) {
  return (
    <section className="editor-layout">
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
                  rect={
                    position === CAPTION_POSITIONS.custom
                      ? customRect
                      : exportPlan.captionRenderPlan.rect
                  }
                />
              </>
            )}
          </div>
        </div>

        <div className="preview-footer">
          <button className="primary-button" disabled={!videoFile} onClick={onExport} type="button">
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

function ExportPage({ renderState }) {
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
    <section className="export-layout final-export-layout">
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
        <p>
          {isComplete
            ? "Your final clip is ready to download."
            : hasFailed
              ? renderState.error || "Something went wrong while finishing your clip."
              : "Finishing your edits now."}
        </p>
        <button className="primary-button download-clip-button" disabled={!isComplete} onClick={handleDownload} type="button">
          <img alt="" aria-hidden="true" className="button-icon" src="/assets/download-icon.png" />
          <span>Download Clip</span>
        </button>
      </aside>
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
