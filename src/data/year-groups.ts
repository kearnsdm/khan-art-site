import bundledGroupsData from "./year-groups.json";
import { loadMetaWithFallback, META_KEYS } from "../lib/meta-store";

/**
 * One row under the "Works" group in the side nav. Each YearGroup
 * corresponds to a slice of years; works whose `year` falls within
 * [minYear, maxYear] appear on that group's page.
 *
 * Both bounds are optional:
 *   minYear + maxYear set, equal     → single year ("2025")
 *   minYear + maxYear set, different → range ("2021–2024")
 *   only maxYear                     → open-ended below ("2020 and earlier")
 *   only minYear                     → open-ended above ("2025 and later")
 *   neither                          → invalid (skipped)
 *
 * `id`, `label`, and `href` are derived from the bounds so URLs reflect
 * the data without needing manual configuration. Nicholas edits these
 * via the admin "Manage year ranges" modal.
 */
export interface YearGroup {
  /** Stable URL slug derived from the bounds (e.g. "2025", "2021-2024", "before-2021"). */
  id: string;
  /** Human-readable label shown in the side nav (e.g. "2025", "2020 and earlier"). */
  label: string;
  /** Full path for the public-site page. */
  href: string;
  /** Long-form display title (e.g. "Paintings, 2025"). */
  pageTitle: string;
  minYear?: number;
  maxYear?: number;
}

interface RawYearGroup {
  minYear?: number;
  maxYear?: number;
}

interface RawYearGroupsFile {
  groups: RawYearGroup[];
}

export function deriveId(g: RawYearGroup): string {
  const { minYear, maxYear } = g;
  if (typeof minYear === "number" && typeof maxYear === "number") {
    if (minYear === maxYear) return String(minYear);
    return `${minYear}-${maxYear}`;
  }
  if (typeof maxYear === "number") return `before-${maxYear + 1}`;
  if (typeof minYear === "number") return `${minYear}-onward`;
  return "all";
}

export function deriveLabel(g: RawYearGroup): string {
  const { minYear, maxYear } = g;
  if (typeof minYear === "number" && typeof maxYear === "number") {
    if (minYear === maxYear) return String(minYear);
    return `${minYear}–${maxYear}`;
  }
  if (typeof maxYear === "number") return `${maxYear} and earlier`;
  if (typeof minYear === "number") return `${minYear} and later`;
  return "All";
}

export function derivePageTitle(g: RawYearGroup): string {
  const label = deriveLabel(g);
  return `Works, ${label}`;
}

export function deriveHref(g: RawYearGroup): string {
  return `/paintings/${deriveId(g)}`;
}

function isValid(g: RawYearGroup): boolean {
  return typeof g.minYear === "number" || typeof g.maxYear === "number";
}

function normalize(raw: RawYearGroupsFile): YearGroup[] {
  const list = Array.isArray(raw?.groups) ? raw.groups : [];
  return list.filter(isValid).map((g) => ({
    id: deriveId(g),
    label: deriveLabel(g),
    href: deriveHref(g),
    pageTitle: derivePageTitle(g),
    minYear: typeof g.minYear === "number" ? g.minYear : undefined,
    maxYear: typeof g.maxYear === "number" ? g.maxYear : undefined,
  }));
}

export async function loadYearGroups(): Promise<YearGroup[]> {
  const raw = await loadMetaWithFallback<RawYearGroupsFile>(
    META_KEYS.yearGroups,
    bundledGroupsData as unknown as RawYearGroupsFile
  );
  return normalize(raw);
}

export function yearGroupById(groups: YearGroup[], id: string): YearGroup | undefined {
  return groups.find((g) => g.id === id);
}
