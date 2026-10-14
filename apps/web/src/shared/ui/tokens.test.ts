import { contrastRatio, readTokens } from '../../test/contrast';
import css from './tokens.css?raw';

const tokens = readTokens(css);
const color = (name: string): string => {
  const value = tokens.get(name);
  if (!value) throw new Error(`--${name} is not defined`);
  return value;
};

const TONES = ['neutral', 'progress', 'success', 'warning', 'danger'] as const;

/** Text on its background: WCAG 2.2 AA, 4.5:1. */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'table'],
  ['ink', 'mount'],
  ['graphite', 'table'],
  ['graphite', 'mount'],
  ['mount', 'ink'],
  ['red', 'mount'],
  ...TONES.flatMap((tone): [string, string][] => [
    [`tone-${tone}`, `tone-${tone}-wash`],
    [`tone-${tone}`, 'mount'],
    [`tone-${tone}`, 'table'],
  ]),
];

/** Control borders, focus ring and state marks: 3:1. */
const NON_TEXT_PAIRS: [string, string][] = [
  ['rule-control', 'table'],
  ['rule-control', 'mount'],
  ['focus', 'table'],
  ['focus', 'mount'],
  ['amber', 'mount'],
  ['green', 'mount'],
  ['red', 'mount'],
];

describe('design tokens', () => {
  it.each(TEXT_PAIRS)('--%s on --%s is readable text', (fg, bg) => {
    expect(contrastRatio(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT_PAIRS)('--%s on --%s stands out as a mark', (fg, bg) => {
    expect(contrastRatio(color(fg), color(bg))).toBeGreaterThanOrEqual(3);
  });

  it('computes contrast like WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#56636f', '#fdfcf8')).toBeCloseTo(6.0, 1);
  });
});
