import { initI18n, resources } from './i18n';

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

describe('initI18n', () => {
  it('starts and switches language when the browser blocks site storage', async () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked);
    onTestFinished(() => {
      getItem.mockRestore();
      setItem.mockRestore();
    });

    const i18n = initI18n();
    expect(getItem).toHaveBeenCalledWith('pdp.language');
    expect(i18n.language).toBe('en');

    await i18n.changeLanguage('uk');
    expect(setItem).toHaveBeenCalledWith('pdp.language', 'uk');
    expect(document.documentElement.lang).toBe('uk');
  });
});
