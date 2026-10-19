export const IMAGE_PRESETS = [
  { name: 'thumb', width: 200 },
  { name: 'medium', width: 800 },
  { name: 'large', width: 1600 },
] as const;

export type ImagePreset = (typeof IMAGE_PRESETS)[number]['name'];

export const PRESET_LABEL_KEY = {
  thumb: 'presets.thumb',
  medium: 'presets.medium',
  large: 'presets.large',
} as const satisfies Record<ImagePreset, string>;

/** Frames: a preview and a frame every 2 s. Transcode: 480p and 720p MP4. Dub: frames, then a translated voice-over. */
export const VIDEO_MODES = ['frames', 'transcode', 'dub'] as const;
export type VideoMode = (typeof VIDEO_MODES)[number];
