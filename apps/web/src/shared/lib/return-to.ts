export const DEFAULT_RETURN_TO = '/library';

/**
 * Where to go after signing in. Only paths inside the app are accepted: anything
 * that could leave the origin, or lead back to sign-in, falls back to the library.
 */
export function safeReturnTo(raw: string | null): string {
  if (!raw?.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return DEFAULT_RETURN_TO;
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) {
    return DEFAULT_RETURN_TO;
  }
  return raw;
}

export function loginPath(returnTo: string): string {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}
