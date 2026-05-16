import bundledWorksData from "./works.json";
import { loadMetaWithFallback, META_KEYS } from "../lib/meta-store";

/**
 * One image of a Work, stored in display order.
 *
 *   filename   — basename only (e.g. "IMG_9955.jpg").
 *   sourceFile — path relative to the work's sourceFolder, including any
 *                subfolders (e.g. "Raleigh Final Photos edited/X.jpg").
 *                Used by the admin to locate the original on disk. May
 *                be undefined for legacy data; fall back to `filename`.
 *   shown      — appears on the work's detail page on the public site.
 *                The first image in `images[]` is always implicitly shown.
 *   featured   — appears in the home page carousel. Featured ⇒ shown.
 *   caption    — optional subtitle shown beneath this specific image.
 *   status     — availability: "nfs" or "sold". Shown in an understated
 *                italicized line under the image's caption.
 */
export interface WorkImage {
  filename: string;
  sourceFile?: string;
  shown: boolean;
  featured?: boolean;
  caption?: string;
  status?: "nfs" | "sold";
}

export interface Work {
  slug: string;
  title: string;
  /**
   * Optional — works without a recognizable year (e.g. loose imports
   * named "IMG_3435.jpg") simply don't show on year-based listings.
   */
  year?: number;
  month?: number;
  day?: number;
  sequence?: number;
  sourceFolder: string;
  images: WorkImage[];
  hiddenImages: string[];
  /** Optional general note about the work. Per-image captions live on `images[i].caption`. */
  caption?: string;
  tags: string[];
  /**
   * Whether the work appears on the public site. When false, the work
   * exists in works.json (so edits persist) but is filtered out of
   * every public listing and detail-page route. Defaults to true for
   * back-compat with works.json entries written before this field
   * existed.
   */
  published: boolean;
}

export type DisplayOrder = "year-month" | "year-sequence";

export interface SiteMeta {
  displayOrder: DisplayOrder;
  hiddenWorks: string[];
}

/**
 * Bundle: every public-facing helper takes one of these. We compute it
 * once per SSR request via `loadWorksData()` and thread it through.
 * Keeping it as a single object means pages and components can pass
 * `data` down to children without bikeshedding which fields they need.
 */
export interface WorksData {
  works: Work[];
  siteMeta: SiteMeta;
}

const DEFAULT_META: SiteMeta = {
  displayOrder: "year-sequence",
  hiddenWorks: [],
};

/**
 * On-disk shape, tolerant of older variants:
 *  - work-level `featured` (we migrate to images[0].featured)
 *  - legacy primaryImage + additionalImages (we migrate to images[])
 */
interface LegacyWork {
  slug: string;
  title: string;
  year?: number;
  section?: string;
  featured?: boolean; // legacy work-level
  sourceFolder: string;
  primaryImage?: string;
  primaryImageAlt?: string;
  additionalImages?: string[];
  tags?: string[];
  month?: number;
  day?: number;
  sequence?: number;
  images?: WorkImage[];
  hiddenImages?: string[];
  caption?: string;
  published?: boolean;
}

interface RawWorksData {
  works: LegacyWork[];
  meta?: Partial<SiteMeta>;
}

function basenameOf(p: string): string {
  return p.split("/").pop() ?? p;
}

function migrateWork(input: LegacyWork): Work {
  const tags = Array.isArray(input.tags) ? input.tags : [];
  const hiddenImages = Array.isArray(input.hiddenImages) ? input.hiddenImages : [];

  let images: WorkImage[];
  if (Array.isArray(input.images) && input.images.length > 0) {
    images = input.images.map((i, idx) => ({
      filename: i.filename,
      sourceFile: typeof i.sourceFile === "string" ? i.sourceFile : undefined,
      shown: idx === 0 ? true : i.shown !== false,
      featured: !!i.featured,
      caption: i.caption,
      status: i.status === "nfs" || i.status === "sold" ? i.status : undefined,
    }));
  } else {
    // Legacy: primaryImage + additionalImages.
    images = [];
    if (input.primaryImage) {
      images.push({ filename: basenameOf(input.primaryImage), shown: true });
    }
    for (const a of input.additionalImages ?? []) {
      images.push({ filename: basenameOf(a), shown: true });
    }
  }

  // Legacy work-level `featured` → promote to images[0].featured.
  if (input.featured && images.length > 0) {
    images[0] = { ...images[0], featured: true };
  }

  return {
    slug: input.slug,
    title: input.title,
    year: typeof input.year === "number" ? input.year : undefined,
    month: typeof input.month === "number" ? input.month : undefined,
    day: typeof input.day === "number" ? input.day : undefined,
    sequence: typeof input.sequence === "number" ? input.sequence : undefined,
    sourceFolder: input.sourceFolder,
    published: input.published !== false,
    images,
    hiddenImages,
    caption: input.caption,
    tags,
  };
}

function mergeMeta(input: Partial<SiteMeta> | undefined): SiteMeta {
  return {
    displayOrder:
      input?.displayOrder === "year-month" || input?.displayOrder === "year-sequence"
        ? input.displayOrder
        : DEFAULT_META.displayOrder,
    hiddenWorks: Array.isArray(input?.hiddenWorks) ? input.hiddenWorks : [],
  };
}

function migrateRaw(raw: RawWorksData | null | undefined): WorksData {
  // Defensive: accept any shape from storage. The previous version
  // crashed with "Cannot read property 'map' of undefined" if Blobs
  // had a JSON value without a `works` array — which then 500'd
  // every public-facing SSR page. Treat missing or non-array `works`
  // as empty and let the rest of the site render normally.
  const works = Array.isArray(raw?.works) ? raw.works as LegacyWork[] : [];
  return {
    works: works.map(migrateWork),
    siteMeta: mergeMeta(raw?.meta),
  };
}

/**
 * Read the current works payload. In production this hits Netlify Blobs
 * (key `_meta/works.json`); in dev it hits the filesystem store; in
 * either case, if storage has nothing yet we fall back to the bundled
 * `src/data/works.json` shipped with the build. That bundled file is
 * what's currently visible on the public site, so the first deploy of
 * this refactor doesn't blank the site out — Nicholas's first save
 * just replaces it.
 *
 * No module-level caching: each SSR render does one read. Reads are
 * fast (single Blobs fetch, ~50 ms) and skipping the cache means
 * Nicholas's saves appear on the public site the moment he hits Save.
 */
export async function loadWorksData(): Promise<WorksData> {
  const raw = await loadMetaWithFallback<RawWorksData>(
    META_KEYS.works,
    bundledWorksData as unknown as RawWorksData
  );
  return migrateRaw(raw);
}

// ---------- pure helpers (all take a WorksData) ----------

export function publishedWorks(data: WorksData): Work[] {
  return data.works.filter((w) => w.published !== false);
}

export function workBySlug(data: WorksData, slug: string): Work | undefined {
  return data.works.find((w) => w.slug === slug);
}

/**
 * Storage key for the image bytes of a given work image. This is the
 * key /api/image?path=... expects. It strips the leading "content/"
 * prefix from sourceFolder (the storage layer is rooted there) and
 * appends sourceFile (if present, includes subfolders) or filename.
 *
 * For loose-file works (sourceFolder itself points at an image), the
 * key IS the stripped sourceFolder — there's no nested file to append.
 */
export function imageStorageKey(work: Work, image: WorkImage): string {
  const stripped = work.sourceFolder.replace(/^content\//, "");
  const looseFile =
    !work.sourceFolder.includes("/") && /\.[a-z0-9]+$/i.test(work.sourceFolder);
  if (looseFile) return stripped;
  const rel =
    image.sourceFile && image.sourceFile.length > 0
      ? image.sourceFile
      : image.filename;
  return `${stripped}/${rel}`;
}

/**
 * Public URL for serving the bytes of a work image. Always routes
 * through /api/image so we can read from Blobs (production) or the
 * local CONTENT_ROOT (dev) without the calling page needing to know
 * where the bytes live.
 *
 * We tack `slug` on as a hint so /api/image can fall back to the
 * bundled `public/works/<slug>/<basename>` file when the Blobs key
 * isn't present. That covers the seeded works whose images were
 * copied into the static bundle during the test phase but never
 * (re-)uploaded to Blobs.
 */
export function imageUrl(work: Work, image: WorkImage): string {
  const key = imageStorageKey(work, image);
  return `/api/image?path=${encodeURIComponent(key)}&slug=${encodeURIComponent(work.slug)}`;
}

export function primaryImagePath(work: Work): string {
  const first = work.images[0];
  if (!first) return "";
  return imageUrl(work, first);
}

export function primaryImageAlt(work: Work): string {
  return `${work.title} painting`;
}

/** Images other than the display image that are flagged shown-on-detail-page. */
export function detailImages(work: Work): { path: string; image: WorkImage }[] {
  return work.images
    .slice(1)
    .filter((i) => i.shown)
    .map((i) => ({ path: imageUrl(work, i), image: i }));
}

/** "Title, Year" or just "Title" when year is missing. */
export function workHeadline(work: Work): string {
  if (typeof work.year === "number") return `${work.title}, ${work.year}`;
  return work.title;
}

function compareYearMonth(a: Work, b: Work): number {
  const ay = a.year ?? 0;
  const by = b.year ?? 0;
  if (ay !== by) return by - ay;
  const am = a.month ?? 0;
  const bm = b.month ?? 0;
  if (am !== bm) return bm - am;
  const ad = a.day ?? 0;
  const bd = b.day ?? 0;
  if (ad !== bd) return bd - ad;
  // Month/day unknown (or tied) — fall back to "Order in year". This
  // way works without explicit dates still get a deterministic, intuitive
  // position relative to others in the same year.
  const aSeq = a.sequence ?? 0;
  const bSeq = b.sequence ?? 0;
  if (aSeq !== bSeq) return bSeq - aSeq;
  return a.title.localeCompare(b.title);
}

function compareYearSequence(a: Work, b: Work): number {
  const ay = a.year ?? 0;
  const by = b.year ?? 0;
  if (ay !== by) return by - ay;
  const aSeq = a.sequence ?? 0;
  const bSeq = b.sequence ?? 0;
  if (aSeq !== bSeq) return bSeq - aSeq;
  return a.title.localeCompare(b.title);
}

export function sortWorksForDisplay(data: WorksData, list: Work[]): Work[] {
  const cmp = data.siteMeta.displayOrder === "year-month"
    ? compareYearMonth
    : compareYearSequence;
  return [...list].sort(cmp);
}

export function worksByYear(data: WorksData, year: number): Work[] {
  return sortWorksForDisplay(data, publishedWorks(data).filter((w) => w.year === year));
}

export function worksByYearRange(
  data: WorksData,
  min: number,
  max: number
): Work[] {
  return sortWorksForDisplay(
    data,
    publishedWorks(data).filter(
      (w) => w.year !== undefined && w.year >= min && w.year <= max
    )
  );
}

export function worksByTag(data: WorksData, tagId: string): Work[] {
  return sortWorksForDisplay(
    data,
    publishedWorks(data).filter((w) => w.tags.includes(tagId))
  );
}

/**
 * Flat list of every image flagged for the home carousel, in site
 * display order. Each entry knows its parent work so the carousel can
 * link back to the work's detail page.
 */
export function featuredImages(data: WorksData): Array<{
  work: Work;
  image: WorkImage;
  imagePath: string;
}> {
  const out: Array<{ work: Work; image: WorkImage; imagePath: string }> = [];
  for (const w of sortWorksForDisplay(data, publishedWorks(data))) {
    for (const img of w.images) {
      if (img.featured && img.shown) {
        out.push({ work: w, image: img, imagePath: imageUrl(w, img) });
      }
    }
  }
  return out;
}
