/** The library's query string the user came from, carried in `location.state` by its tiles. */
export function librarySearchOf(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('librarySearch' in state)) return '';
  const { librarySearch } = state;
  return typeof librarySearch === 'string' && librarySearch.startsWith('?') ? librarySearch : '';
}
