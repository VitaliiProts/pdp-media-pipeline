const channel = (hex: string, offset: number): number => {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

/** Relative luminance of a `#rrggbb` colour, as WCAG 2.2 defines it. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`expected #rrggbb, got ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `--name: value;` pairs of a stylesheet, with one level of `var(--x)` resolved. */
export function readTokens(css: string): Map<string, string> {
  const raw = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (name && value && !raw.has(name)) raw.set(name, value.trim());
  }
  const resolved = new Map<string, string>();
  for (const [name, value] of raw) {
    const ref = /^var\(--([a-z0-9-]+)\)$/.exec(value)?.[1];
    resolved.set(name, ref ? (raw.get(ref) ?? value) : value);
  }
  return resolved;
}
