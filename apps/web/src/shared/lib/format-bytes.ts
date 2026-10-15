/** Decimal steps: Intl knows kilobytes and megabytes, not kibibytes. */
const STEP = 1000;
const UNITS = ['byte', 'kilobyte', 'megabyte'] as const;

const byteSymbol = (locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'unit', unit: 'byte', unitDisplay: 'narrow' })
    .formatToParts(0)
    .find((part) => part.type === 'unit')?.value ?? 'B';

export function formatBytes(bytes: number, locale: string): string {
  let value = bytes;
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }
  const parts = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).formatToParts(value);
  // The short form of a byte is the whole word in English ("144 byte"); keep its layout, use the symbol.
  return parts
    .map((part) => (unit === 0 && part.type === 'unit' ? byteSymbol(locale) : part.value))
    .join('');
}
