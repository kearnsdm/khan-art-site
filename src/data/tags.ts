import tagsData from "./tags.json";

/**
 * Category vocabulary. Loaded from src/data/tags.json and editable from
 * the admin "Manage categories" modal.
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

interface RawTag {
  id: string;
  label: string;
  inNav?: boolean;
}

export const tags: Tag[] = (tagsData.tags as RawTag[]).map((t) => ({
  id: t.id,
  label: t.label,
  inNav: !!t.inNav,
}));

export const tagIds = new Set(tags.map((t) => t.id));

export function tagLabel(id: string): string {
  return tags.find((t) => t.id === id)?.label ?? id;
}

/** Tags flagged to appear in the public site menu, in their defined order. */
export const navTags: Tag[] = tags.filter((t) => t.inNav);
