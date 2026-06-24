export type FrameSize = {
  width: number;
  height: number;
};

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CaptionPosition = "top" | "middle" | "lower-safe" | "custom";
export type SubjectKind = "face" | "head" | "upper-body" | "person";
export type SubjectDetection = {
  id?: string;
  kind?: SubjectKind;
  type?: SubjectKind;
  box: Rect;
  confidence?: number;
  frameTimeMs?: number;
};

export const INSTAGRAM_REEL_FORMAT: FrameSize & { aspectRatio: number };
export const CAPTION_POSITIONS: {
  top: "top";
  middle: "middle";
  lowerSafe: "lower-safe";
  custom: "custom";
};
export const WATERMARK_CORNERS: {
  unknown: "unknown";
  bottomLeft: "bottom-left";
  bottomRight: "bottom-right";
};

export function getRecommendedCaptionPositions(): Array<{
  id: CaptionPosition;
  label: string;
  description: string;
}>;

export function createKickClipExportPlan(input: {
  source: FrameSize;
  target?: FrameSize;
  videoId?: string;
  jobId?: string;
  sourcePath?: string;
  outputPath?: string;
  captionText: string;
  captionStyle?: {
    preset?: string;
    background?: "white" | "black" | "none";
    textColor?: string;
    fontFamily?: string;
    fontSize?: number;
  };
  kickBranding?: {
    enabled?: boolean;
    link?: string;
  };
  captionPosition?: CaptionPosition;
  customRect?: Rect;
  subjectDetections?: SubjectDetection[];
  faceDetections?: SubjectDetection[];
  personDetections?: SubjectDetection[];
  faceBox?: Rect;
  faceConfidence?: number;
  headBox?: Rect;
  headConfidence?: number;
  avoidWatermark?: boolean;
  watermarkCorner?: string;
  captionBox?: {
    widthRatio?: number;
    heightRatio?: number;
  };
  ffmpegPath?: string;
  safeZones?: Array<unknown>;
}): any;

export function createPersonAwareReelPlan(input: {
  source: FrameSize;
  target?: FrameSize;
  subjectDetections?: SubjectDetection[];
  faceBox?: Rect;
  faceConfidence?: number;
  headBox?: Rect;
  headConfidence?: number;
}): any;
