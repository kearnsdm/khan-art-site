import bundledTagsData from "./tags.json";
import { loadMetaWithFallback, META_KEYS } from "../lib/meta-store";

/**
 * Category vocabulary. Loaded from Netlify Blobs in production
 * (`_meta/tags.json`) or the local filesystem in dev, with the bundled
 * `src/data/tags.json` as a first-deploy fallback.
 *
 *   id     — stable kebab-case identifier (used in URLs + saved data)
 *   label  — display text shown in the admin chips and the public site
 *   inNav  — when true, the category appears as a clickable item in the
 *            site-wide left-side menu, linking to /category/<id>
 */
export interface Tag {
  id: string;
  label: string;
  inNav?: boolean;
}

interface RawTagsFile {
  tags: Tag[];
}

function normalize(raw: RawTagsFile): Tag[] {
  const list = Array.isArray(raw?.tags) ? raw.tags : [];
  return list.map((t) => ({
    id: t.id,
    label: t.label,
    inNav: !!t.inNav,
  }));
}

export async function loadTags(): Promise<Tag[]> {
  const raw = await loadMetaWithFallback<RawTagsFile>(
    META_KEYS.tags,
    bundledTagsData as unknown as RawTagsFile
  );
  return normalize(raw);
}

/**
 * Subset of tags flagged to appear in the public site menu, in their
 * defined order. Convenience wrapper around `loadTags`.
 */
export async function loadNavTags(): Promise<Tag[]> {
  return (await loadTags()).filter((t) => t.inNav);
}

/**
 * Synchronous helper used by API routes that have already loaded the
 * tag list and just need to do a lookup or label resolution against
 * it. Keeps the hot paths from having to re-await.
 */
export function tagIdSet(tags: Tag[]): Set<string> {
  return new Set(tags.map((t) => t.id));
}

export function tagLabel(tags: Tag[], id: string): string {
  return tags.find((t) => t.id === id)?.label ?? id;
}
