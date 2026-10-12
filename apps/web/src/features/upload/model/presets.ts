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
