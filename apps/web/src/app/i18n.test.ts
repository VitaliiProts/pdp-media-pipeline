import { resources } from './i18n';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** Plural forms differ by language (uk has few/many), so only the base key must match. */
const baseKeys = (tree: unknown) =>
  [...new Set(keysOf(tree).map((key) => key.replace(PLURAL_SUFFIX, '')))].sort();

const uk = new Map<string, unknown>(Object.entries(resources.uk));

describe('translations', () => {
  it.each(Object.entries(resources.en))('has the same keys in both languages: %s', (ns, en) => {
    expect(baseKeys(uk.get(ns))).toEqual(baseKeys(en));
  });
});
