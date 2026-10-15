/**
 * `localStorage` that never throws: a browser with site storage blocked throws on every access,
 * and nothing kept there is worth failing over.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Not remembered; the value still applies to this page.
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Blocked storage holds nothing to remove.
    }
  },
};
