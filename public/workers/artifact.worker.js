/* eslint-disable no-restricted-globals */
/**
 * Artifact worker.
 *
 * Two jobs that are pure compute and would otherwise block paint:
 *   • SHA-256 of a large body (crypto.subtle is available in workers)
 *   • text metrics for the preview pane (lines, words, longest line)
 *
 * Kept as a plain script in `public/` rather than a bundler entry so it can be
 * fetched and run byte-for-byte as served, and so the service worker can cache
 * it under the same URL the page asks for.
 */

self.addEventListener('message', async (event) => {
  const data = event.data || {};
  const id = data.id;

  try {
    if (data.bytes) {
      const digest = await crypto.subtle.digest('SHA-256', data.bytes);
      const hash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      self.postMessage({ id, hash });
      return;
    }

    if (typeof data.text === 'string') {
      const lines = data.text.split('\n');
      let longest = 0;
      for (const line of lines) if (line.length > longest) longest = line.length;
      self.postMessage({
        id,
        metrics: {
          lines: lines.length,
          chars: data.text.length,
          words: (data.text.match(/\S+/g) || []).length,
          longestLine: longest,
        },
      });
      return;
    }

    self.postMessage({ id, error: 'unsupported request' });
  } catch (error) {
    self.postMessage({ id, error: String((error && error.message) || error) });
  }
});
