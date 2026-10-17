import { initI18n, resources, storedLanguage } from './i18n';

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

describe('language', () => {
  it('starts in English, without reading site storage, so the server can render it', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    onTestFinished(() => getItem.mockRestore());
    expect(initI18n().language).toBe('en');
    expect(getItem).not.toHaveBeenCalled();
  });

  it('remembers only a language it has', () => {
    expect(storedLanguage()).toBeNull();
    window.localStorage.setItem('pdp.language', 'uk');
    expect(storedLanguage()).toBe('uk');
    for (const other of ['de', 'toString', '']) {
      window.localStorage.setItem('pdp.language', other);
      expect(storedLanguage()).toBeNull();
    }
  });

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

    expect(storedLanguage()).toBeNull();
    expect(getItem).toHaveBeenCalledWith('pdp.language');
    const i18n = initI18n(storedLanguage() ?? undefined);
    expect(i18n.language).toBe('en');

    await i18n.changeLanguage('uk');
    expect(setItem).toHaveBeenCalledWith('pdp.language', 'uk');
    expect(document.documentElement.lang).toBe('uk');
  });
});
