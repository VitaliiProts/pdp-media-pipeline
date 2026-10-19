import { useEffect, useState } from 'react';
import { storageHttp } from '../../../shared/api/http';

/**
 * A same-origin blob URL of the subtitles, so the `<track>` needs no CORS mode on the video
 * itself. Fetched once from the first signed link; null until loaded or if it fails.
 */
export function useSubtitlesUrl(url: string): string | null {
  const [first] = useState(url);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let created: string | null = null;
    storageHttp
      .get<string>(first, { responseType: 'text', signal: controller.signal })
      .then(({ data }) => {
        created = URL.createObjectURL(new Blob([data], { type: 'text/vtt' }));
        setBlobUrl(created);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [first]);

  return blobUrl;
}
