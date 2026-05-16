import { contentStorage } from "./content-storage";

/**
 * Storage layer for the site's metadata JSONs (works, tags, year-groups).
 *
 * Why this exists: the original architecture wrote these JSON files to
 * `src/data/` on local disk and read them back with `import worksData
 * from "./works.json"`. That broke in production because the bundled
 * Lambda filesystem is read-only — saves crashed with EROFS, and the
 * public-side pages were stuck rendering whatever was in git at build
 * time. This module routes those reads/writes through the storage
 * abstraction (Netlify Blobs in prod, filesystem in dev) so Nicholas's
 * edits actually persist and the public site can read live data.
 *
 * The metadata keys live under a "_meta/" prefix to keep them out of
 * the way of image keys (which are just plain "<year>/<folder>/<file>"
 * paths from the scanner).
 *
 * Fallback behavior: when a key is missing in storage — which is true
 * on the very first deploy, before any save has happened — `load` falls
 * back to the bundled JSON shipped with the build. That way Nicholas
 * doesn't see an empty site the moment we ship the refactor; he sees
 * whatever was in git at build time, until his first save replaces it.
 */

/** Storage key conventions. Underscore prefix avoids collision with image paths. */
export const META_KEYS = {
  works: "_meta/works.json",
  tags: "_meta/tags.json",
  yearGroups: "_meta/year-groups.json",
} as const;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Read a JSON metadata blob from storage. Returns null if the key
 * isn't present — callers decide whether to fall back to bundled data
 * or treat the absence as "no data yet".
 */
export async function loadMeta<T>(key: string): Promise<T | null> {
  const store = contentStorage();
  const bytes = await store.get(key);
  if (!bytes) return null;
  try {
    const text = decoder.decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    // Corrupt JSON shouldn't crash the site — treat as missing and let
    // the caller fall back. We surface this as a console.error so it
    // shows up in Netlify function logs without taking the page down.
    console.error("[meta-store] could not parse", key);
    return null;
  }
}

/**
 * Convenience wrapper: try `loadMeta`, then return `bundled` if storage
 * had nothing. Lets callers write one-liner loads at the call site.
 */
export async function loadMetaWithFallback<T>(
  key: string,
  bundled: T
): Promise<T> {
  const fromStore = await loadMeta<T>(key);
  return fromStore ?? bundled;
}

/**
 * Persist a JSON metadata blob to storage. Always writes pretty-printed
 * + trailing newline so the file diffs cleanly when we inspect it via
 * the Netlify Blobs UI (and so the local-dev file remains readable
 * when CONTENT_ROOT picks it up).
 */
export async function saveMeta(key: string, data: unknown): Promise<void> {
  const store = contentStorage();
  const text = JSON.stringify(data, null, 2) + "\n";
  const bytes = encoder.encode(text);
  await store.put(key, bytes, {
    size: String(bytes.byteLength),
    lastModified: String(Date.now()),
  });
}
