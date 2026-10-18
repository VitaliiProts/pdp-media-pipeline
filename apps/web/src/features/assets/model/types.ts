export const ASSET_KINDS = ['image', 'video'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** What the latest job says about a file; the gateway filters by it. */
export const ASSET_STATUSES = ['processing', 'ready', 'failed'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Mirrors `ASSET_SEARCH_MAX_LENGTH` in @pdp/contracts. */
export const ASSET_SEARCH_MAX_LENGTH = 100;

export type AssetJobStatus = 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'dead';

const ACTIVE: readonly AssetJobStatus[] = ['queued', 'scheduled', 'running'];
export const isActiveJobStatus = (status: AssetJobStatus): boolean => ACTIVE.includes(status);

export type Asset = {
  id: string;
  kind: AssetKind;
  name: string | null;
  contentType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  sourceKey: string;
  createdAt: string;
};

export type AssetSummary = Asset & {
  preview: { url: string; width: number; height: number } | null;
  latestJob: {
    id: string;
    type: string;
    status: AssetJobStatus;
    /** Percent, while running; only long job types report it. */
    progress?: number | null;
  } | null;
  /** Languages of finished dubs, sorted. */
  dubs: string[];
};

export type AssetPage = { items: AssetSummary[]; nextCursor: string | null };

/** `downloadUrl` is signed to be saved, not shown. */
type Download = { url: string; downloadUrl: string };

export type AssetImageVersion = {
  preset: string;
  width: number;
  height: number;
  bytes: number;
} & Download;

export type AssetFrame = {
  atSeconds: number;
  width: number;
  height: number;
  bytes: number;
} & Download;

export type AssetRendition = {
  rendition: string;
  width: number;
  height: number;
  durationSeconds: number;
  bytes: number;
  bitrate: number;
} & Download;

type VideoFacts = { durationSeconds: number; width: number; height: number; codec: string };

export type AssetDubSpeaker = {
  id: string;
  gender: 'male' | 'female';
  /** How sure the analysis was, 0–1; the gender is whichever side of 0.5 it fell. */
  maleProbability: number;
  voice: string;
  /** Speech of this speaker in the video. */
  seconds: number;
};

/** Seconds from the start of the video; `placed*` is where the dubbed phrase is spoken. */
export type AssetDubPhrase = {
  id: string;
  turn: string;
  speaker: string;
  start: number;
  end: number;
  source: string;
  target: string;
  placedStart: number;
  placedEnd: number;
  speed: number;
  refitted: boolean;
};

export type AssetDub = {
  durationSeconds: number;
  /** Detected, or the one the dub was asked to assume. */
  sourceLanguage: string;
  targetLanguage: string;
  video: { bytes: number } & Download;
  subtitles: Download;
  speakers: AssetDubSpeaker[];
  phrases: AssetDubPhrase[];
  /** Voice no recognised word covers: shown, never dubbed. */
  unrecognized: { start: number; end: number }[];
  stats: {
    phrases: number;
    sped: number;
    refitted: number;
    overflowed: number;
    meanEndErrorSeconds: number;
  };
};

export type AssetJob = {
  id: string;
  type: string;
  status: AssetJobStatus;
  /** What the job was asked to do, as sent. */
  input?: Record<string, unknown>;
  attempts: number;
  /** `code: message` for the codes a worker knows. */
  lastError: string | null;
  deadReason: 'permanent' | 'exhausted' | null;
  createdAt: string;
  traceId: string | null;
  /** Percent and the step under way, while running; only long job types report them. */
  progress?: number | null;
  progressStep?: string | null;
  results?: AssetImageVersion[];
  video?: VideoFacts & { preview: AssetFrame; frames: AssetFrame[] };
  transcode?: VideoFacts & { preview: AssetFrame; renditions: AssetRendition[] };
  dub?: AssetDub;
};

export type AssetDetails = Asset & {
  originalUrl: string;
  originalDownloadUrl: string;
  jobs: AssetJob[];
  jobsNextCursor: string | null;
};

export type AssetFilters = {
  kind: AssetKind | null;
  status: AssetStatus | null;
  q: string;
  /** Only files with a finished translation. */
  dubbed: boolean;
};
