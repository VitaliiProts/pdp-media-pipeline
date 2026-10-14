export const DEFAULT_RETURN_TO = '/library';

const hasControlCharacter = (value: string) =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

/**
 * Where to go after signing in. Only paths inside the app are accepted: anything
 * that could leave the origin, or lead back to sign-in, falls back to the library.
 * Browsers drop tabs and newlines from URLs, so `/\t/evil.example` would become
 * protocol-relative; the address is resolved against the origin to be sure.
 */
export function safeReturnTo(raw: string | null): string {
  if (
    !raw?.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    hasControlCharacter(raw)
  ) {
    return DEFAULT_RETURN_TO;
  }
  const { origin } = window.location;
  const url = new URL(raw, origin);
  if (url.origin !== origin) return DEFAULT_RETURN_TO;
  const path = url.pathname.toLowerCase();
  if (path === '/login' || path.startsWith('/login/')) return DEFAULT_RETURN_TO;
  return url.pathname + url.search + url.hash;
}

export function loginPath(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}
