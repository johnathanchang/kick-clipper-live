"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [avoidWatermark, setAvoidWatermark] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(true);
  const [uploadState, setUploadState] = useState({ status: "idle" });
  const [jobState, setJobState] = useState({ status: "idle" });
  const [serverExportState, setServerExportState] = useState({ status: "idle" });
  const [renderState, setRenderState] = useState({ status: "idle" });

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

  async function requestServerExportPlan() {
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
        throw new Error(data.error || "Export payload generation failed.");
      }

      setServerExportState({ status: "planned", result: data.exportPlan });
    } catch (error) {
      setServerExportState({
        status: "failed",
        error: error instanceof Error ? error.message : "Export payload generation failed.",
      });
    }
  }

  async function requestRender() {
    const exportPlan = serverExportState.result ?? localExportPlan;

    setRenderState({ status: "rendering" });

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportPlan }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Render failed.");
      }

      setRenderState({ status: "complete", result: data });
    } catch (error) {
      setRenderState({
        status: "failed",
        error: error instanceof Error ? error.message : "Render failed.",
      });
    }
  }

  return (
    <div className="app-shell">
      <Header currentStep={step} onNavigate={setStep} hasVideo={Boolean(videoFile)} />

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
            avoidWatermark={avoidWatermark}
            captionBackground={captionBackground}
            captionText={captionText}
            customRect={customRect}
            exportPlan={localExportPlan}
            fontSize={fontSize}
            kickBrandingEnabled={kickBrandingEnabled}
            kickLink={kickLink}
            position={position}
            showSafeZones={showSafeZones}
            jobState={jobState}
            uploadState={uploadState}
            videoFile={videoFile}
            videoUrl={videoUrl}
            onAvoidWatermarkChange={setAvoidWatermark}
            onCaptionBackgroundChange={setCaptionBackground}
            onCaptionTextChange={setCaptionText}
            onCustomRectChange={setCustomRect}
            onExport={() => setStep("export")}
            onFontSizeChange={setFontSize}
            onKickBrandingEnabledChange={setKickBrandingEnabled}
            onKickLinkChange={setKickLink}
            onPositionChange={setPosition}
            onShowSafeZonesChange={setShowSafeZones}
            onVideoMetadata={setSourceDimensions}
          />
        )}

        {step === "export" && (
          <ExportPage
            exportInput={exportInput}
            localExportPlan={localExportPlan}
            jobState={jobState}
            renderState={renderState}
            serverExportState={serverExportState}
            uploadState={uploadState}
            videoFile={videoFile}
            onBackToEditor={() => setStep("editor")}
            onCreateExportPlan={requestServerExportPlan}
            onNewClip={() => {
              setVideoFile(null);
              setSourceDimensions(null);
              setServerExportState({ status: "idle" });
              setRenderState({ status: "idle" });
              setUploadState({ status: "idle" });
              setJobState({ status: "idle" });
              setStep("upload");
            }}
            onRender={requestRender}
          />
        )}
      </main>
    </div>
  );
}

function Header({ currentStep, onNavigate, hasVideo }) {
  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">Kick Clipper</p>
        <h1>Watermark-aware captions for Kick clips</h1>
      </div>

      <nav className="step-nav" aria-label="Workflow">
        {["upload", "editor", "export"].map((step) => (
          <button
            className={currentStep === step ? "active" : ""}
            disabled={step !== "upload" && !hasVideo}
            key={step}
            onClick={() => onNavigate(step)}
            type="button"
          >
            {step[0].toUpperCase() + step.slice(1)}
          </button>
        ))}
      </nav>
    </header>
  );
}

function UploadPage({ jobState, uploadState, videoFile, onVideoUpload, onContinue }) {
  return (
    <section className="upload-layout">
      <div className="upload-copy">
        <p className="eyebrow">Streamer MVP</p>
        <h2>Upload a Kick clip and prepare captions fast.</h2>
        <p>
          Start with a local video file. Kick Clipper immediately shows the
          9:16 caption preview and sends the file to the backend upload route
          when Supabase is configured.
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
  avoidWatermark,
  captionBackground,
  captionText,
  customRect,
  exportPlan,
  fontSize,
  kickBrandingEnabled,
  kickLink,
  position,
  showSafeZones,
  jobState,
  uploadState,
  videoFile,
  videoUrl,
  onAvoidWatermarkChange,
  onCaptionBackgroundChange,
  onCaptionTextChange,
  onCustomRectChange,
  onExport,
  onFontSizeChange,
  onKickBrandingEnabledChange,
  onKickLinkChange,
  onPositionChange,
  onShowSafeZonesChange,
  onVideoMetadata,
}) {
  return (
    <section className="editor-layout">
      <div className="preview-panel">
        <div className="preview-stage">
          <div className="video-frame">
            {videoFile ? (
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
            ) : (
              <div className="empty-preview">
                <p>No video selected</p>
                <span>Upload a clip to see the preview.</span>
              </div>
            )}

            {videoFile && (
              <>
                {showSafeZones && <SafeZoneOverlay safeZones={exportPlan.safeZones} />}
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
                {kickBrandingEnabled && <KickBrandBar link={normalizeKickLink(kickLink)} />}
              </>
            )}
          </div>
        </div>

        <div className="preview-footer">
          <div>
            <p>9:16 Reel preview</p>
            <span>{buildPlacementSummary(exportPlan)}</span>
          </div>
          <button className="primary-button" disabled={!videoFile} onClick={onExport} type="button">
            Export clip
          </button>
        </div>

        <UploadStatus uploadState={uploadState} compact />
        <JobStatus jobState={jobState} compact />
      </div>

      <CaptionSettingsPanel
        avoidWatermark={avoidWatermark}
        captionBackground={captionBackground}
        captionText={captionText}
        exportPlan={exportPlan}
        fontSize={fontSize}
        kickBrandingEnabled={kickBrandingEnabled}
        kickLink={kickLink}
        position={position}
        showSafeZones={showSafeZones}
        onAvoidWatermarkChange={onAvoidWatermarkChange}
        onCaptionBackgroundChange={onCaptionBackgroundChange}
        onCaptionTextChange={onCaptionTextChange}
        onFontSizeChange={onFontSizeChange}
        onKickBrandingEnabledChange={onKickBrandingEnabledChange}
        onKickLinkChange={onKickLinkChange}
        onPositionChange={onPositionChange}
        onShowSafeZonesChange={onShowSafeZonesChange}
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

function KickBrandBar({ link }) {
  return (
    <div className="kick-brand-bar">
      <div className="kick-logo-block">
        <img alt="Kick" src="/brand/kick-logo.png" />
      </div>
      <div className="kick-link-text">{link.toUpperCase()}</div>
    </div>
  );
}

function CaptionSettingsPanel({
  avoidWatermark,
  captionBackground,
  captionText,
  exportPlan,
  fontSize,
  kickBrandingEnabled,
  kickLink,
  position,
  showSafeZones,
  onAvoidWatermarkChange,
  onCaptionBackgroundChange,
  onCaptionTextChange,
  onFontSizeChange,
  onKickBrandingEnabledChange,
  onKickLinkChange,
  onPositionChange,
  onShowSafeZonesChange,
}) {
  const positions = getRecommendedCaptionPositions();

  return (
    <aside className="settings-panel">
      <div>
        <p className="eyebrow">Caption settings</p>
        <h2>Place captions outside Kick watermark risk zones.</h2>
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

      <label className="toggle-row">
        <input
          checked={avoidWatermark}
          onChange={(event) => onAvoidWatermarkChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Avoid Kick watermark</strong>
          <small>Move risky placements away from bottom-corner overlay zones.</small>
        </span>
      </label>

      <label className="toggle-row">
        <input
          checked={showSafeZones}
          onChange={(event) => onShowSafeZonesChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Show safe-zone preview</strong>
          <small>Display the same exclusion zones used for export planning.</small>
        </span>
      </label>

      <div className="integration-note">
        <p>{exportPlan.requestedCaption.adjustedForSafety ? "Adjusted for safety" : "Placement ready"}</p>
        <span>{buildPlacementSummary(exportPlan)}</span>
      </div>
    </aside>
  );
}

function ExportPage({
  exportInput,
  localExportPlan,
  jobState,
  renderState,
  serverExportState,
  uploadState,
  videoFile,
  onBackToEditor,
  onCreateExportPlan,
  onNewClip,
  onRender,
}) {
  const visiblePlan = serverExportState.result ?? localExportPlan;
  const canRender = uploadState.status === "uploaded" && renderState.status !== "rendering";
  const exportStatusText =
    renderState.status === "complete"
      ? "Rendered MP4 saved to Supabase Storage"
      : renderState.status === "rendering"
        ? "Backend renderer is processing"
        : serverExportState.status === "planned"
          ? "Backend export payload generated"
          : "Local export payload ready";

  return (
    <section className="export-layout">
      <div className="export-panel">
        <p className="eyebrow">Export</p>
        <h2>Export plan ready</h2>
        <p>
          This export plan is ready for the backend renderer to crop, scale, and burn captions
          into the final MP4.
        </p>

        <div className="export-summary-card">
          <div>
            <span>Clip</span>
            <strong>{videoFile?.name || "No video selected"}</strong>
          </div>
          <div>
            <span>Backend upload</span>
            <strong>{describeUpload(uploadState)}</strong>
          </div>
          <div>
            <span>Processing job</span>
            <strong>{describeJob(jobState)}</strong>
          </div>
          <div>
            <span>Caption placement</span>
            <strong>{buildPlacementSummary(visiblePlan)}</strong>
          </div>
          <div>
            <span>Kick link bar</span>
            <strong>
              {visiblePlan.kickBranding?.enabled
                ? `Included: ${visiblePlan.kickBranding.link}`
                : "Not included"}
            </strong>
          </div>
        </div>

        <p className="next-step-message">
          Keep the actions below visible while you generate the payload or render the MP4.
        </p>

        <div className="export-actions">
          <button className="secondary-button" onClick={onBackToEditor} type="button">
            Back to editor
          </button>
          <button
            className="primary-button"
            disabled={!videoFile || serverExportState.status === "planning"}
            onClick={onCreateExportPlan}
            type="button"
          >
            {serverExportState.status === "planning" ? "Generating..." : "Generate backend payload"}
          </button>
          <button
            className="primary-button"
            disabled={!canRender}
            onClick={onRender}
            type="button"
          >
            {renderState.status === "rendering" ? "Rendering..." : "Render MP4"}
          </button>
          <button className="ghost-button" onClick={onNewClip} type="button">
            New clip
          </button>
        </div>

        {serverExportState.status === "failed" && (
          <section className="error-banner" aria-label="Export payload error output">
            <strong>Payload output</strong>
            <pre className="ffmpeg-error-output">{serverExportState.error}</pre>
          </section>
        )}

        {uploadState.status !== "uploaded" && (
          <p className="error-banner">
            Upload the clip to backend storage before rendering an MP4.
          </p>
        )}

        {renderState.status === "failed" && (
          <section className="error-banner" aria-label="Render error">
            <strong>Render error</strong>
            <pre className="ffmpeg-error-output">{renderState.error}</pre>
          </section>
        )}

        {renderState.status === "complete" && (
          <div className="render-result">
            <p>Rendered MP4 ready</p>
            <span>{renderState.result.outputPath}</span>
            <span>{renderState.result.captionBurnIn?.enabled ? "Captions included" : "Caption render unavailable"}</span>
            <span>{renderState.result.kickBranding?.enabled ? "Kick link bar included" : "Kick link bar not included"}</span>
            {renderState.result.signedUrl && (
              <a href={renderState.result.signedUrl} rel="noreferrer" target="_blank">
                Open signed download
              </a>
            )}
          </div>
        )}

        <details className="advanced-details">
          <summary>Advanced details</summary>
          <p>
            Raw export-plan JSON for engineers. This describes how the renderer should crop,
            place captions, handle watermark-safe placement, and build FFmpeg arguments.
          </p>
          <pre className="payload-preview">
            {JSON.stringify(
              {
                videoId: visiblePlan.videoId,
                jobId: visiblePlan.jobId,
                source: visiblePlan.reelPlan.source,
                target: visiblePlan.reelPlan.target,
                selectedCrop: visiblePlan.selectedCrop,
                detectedPrimarySubject: visiblePlan.detectedPrimarySubject,
                faceSafeZone: visiblePlan.faceSafeZone,
                captionRect: visiblePlan.captionRect,
                captionStyle: visiblePlan.captionStyle,
                kickBranding: visiblePlan.kickBranding,
                kickBrandingOverlay: visiblePlan.kickBrandingOverlay,
                fallbackReason: visiblePlan.fallbackReason,
                caption: visiblePlan.requestedCaption,
                ffmpeg: visiblePlan.ffmpeg,
              },
              null,
              2,
            )}
          </pre>
        </details>
      </div>

      <div className="export-status" role="status">
        <span className="status-dot" />
        {exportStatusText}
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
  if (uploadState.status === "uploading") return "Uploading to backend...";
  if (uploadState.status === "uploaded") return `Uploaded; job ${uploadState.result.jobId}`;
  if (uploadState.status === "local-only") return `Local preview only: ${uploadState.error}`;
  return "Not uploaded yet";
}

function describeJob(jobState) {
  if (jobState.status === "polling") return "Checking backend processing job...";
  if (jobState.status === "failed") return `Job status unavailable: ${jobState.error}`;
  if (jobState.status === "synced" && jobState.job) {
    if (jobState.job.status === "failed") {
      return `Processing failed: ${jobState.job.error_message || "Unknown error"}`;
    }

    return `Processing job ${jobState.job.status}`;
  }

  return "No backend job yet";
}

function formatBackendIds(exportInput) {
  if (!exportInput.videoId && !exportInput.jobId) {
    return "Local preview only";
  }

  return [`video ${exportInput.videoId || "n/a"}`, `job ${exportInput.jobId || "n/a"}`].join(", ");
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
