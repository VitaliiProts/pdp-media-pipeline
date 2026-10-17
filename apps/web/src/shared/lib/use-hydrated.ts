import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * `false` on the server and while React hydrates prerendered HTML, `true` from the render right
 * after; a page rendered in the browser from scratch gets `true` at once. What the build could
 * not know (the query string, the visitor's settings) waits for it, so hydration matches.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
