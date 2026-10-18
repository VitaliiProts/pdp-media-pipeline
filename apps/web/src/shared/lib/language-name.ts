const cache = new Map<string, Intl.DisplayNames>();

/** "Ukrainian" for `uk` in English, "Українська" in Ukrainian; the code itself if unknown. */
export function languageName(code: string, locale: string): string {
  let names = cache.get(locale);
  if (!names) {
    names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' });
    cache.set(locale, names);
  }
  const name = names.of(code);
  if (!name || name === code) return code;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}
