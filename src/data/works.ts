import worksData from "./works.json";

/**
 * One image of a Work, stored in display order.
 *
 *   filename  — basename only (e.g. "IMG_9955.jpg"). Used to build the
 *               public URL `/works/<slug>/<filename>`.
 *   sourceFile — path relative to the work's sourceFolder, including any
 *               subfolders (e.g. "Raleigh Final Photos edited/X.jpg").
 *               Used by the admin to locate the original on disk. May be
 *               undefined for legacy data; fall back to `filename`.
 *   shown      — appears on the work's detail page on the public site.
 *               The first image in `images[]` is always implicitly shown.
 *   featured   — appears in the home page carousel. Featured ⇒ shown.
 *   caption    — optional subtitle shown beneath this specific image.
 *   status     — availability: "nfs" or "sold". Shown in an understated
 *               italicized line under the image's caption.
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
    // Default to published=true for back-compat: entries written before
    // the `published` field existed were always implicitly published.
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

const raw = worksData as unknown as RawWorksData;

/**
 * Full list of every work in works.json — published and unpublished
 * alike. Used by the admin (which needs to see drafts) and by the work
 * detail-page builder (which prerenders one page per slug, including
 * drafts so direct URLs still resolve).
 *
 * The PUBLIC-facing helpers below (`worksByYear`, `featuredImages`, etc.)
 * filter this list to only `published === true` so unpublished works
 * never show in galleries, side-nav, or the homepage carousel.
 */
export const works: Work[] = (raw.works as LegacyWork[]).map(migrateWork);

/** Only the works actually visible on the public site. */
function publishedWorks(): Work[] {
  return works.filter((w) => w.published !== false);
}

export const siteMeta: SiteMeta = mergeMeta(raw.meta);

// ---------- derived helpers ----------

export function primaryImagePath(work: Work): string {
  const first = work.images[0];
  if (!first) return "";
  return `/works/${work.slug}/${first.filename}`;
}

export function primaryImageAlt(work: Work): string {
  return `${work.title} painting`;
}

/** Images other than the display image that are flagged shown-on-detail-page. */
export function detailImages(work: Work): { path: string; image: WorkImage }[] {
  return work.images
    .slice(1)
    .filter((i) => i.shown)
    .map((i) => ({ path: `/works/${work.slug}/${i.filename}`, image: i }));
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

export function sortWorksForDisplay(list: Work[]): Work[] {
  const cmp = siteMeta.displayOrder === "year-month"
    ? compareYearMonth
    : compareYearSequence;
  return [...list].sort(cmp);
}

export function worksByYear(year: number): Work[] {
  return sortWorksForDisplay(publishedWorks().filter((w) => w.year === year));
}

export function worksByYearRange(min: number, max: number): Work[] {
  return sortWorksForDisplay(
    publishedWorks().filter((w) => w.year !== undefined && w.year >= min && w.year <= max)
  );
}

export function worksByTag(tagId: string): Work[] {
  return sortWorksForDisplay(publishedWorks().filter((w) => w.tags.includes(tagId)));
}

/**
 * Flat list of every image flagged for the home carousel, in site display
 * order (year + sequence/month, depending on meta). Each entry knows its
 * parent work so the carousel can link back to the work's detail page.
 */
export function featuredImages(): Array<{
  work: Work;
  image: WorkImage;
  imagePath: string;
}> {
  const out: Array<{ work: Work; image: WorkImage; imagePath: string }> = [];
  for (const w of sortWorksForDisplay(publishedWorks())) {
    for (const img of w.images) {
      if (img.featured && img.shown) {
        out.push({
          work: w,
          image: img,
          imagePath: `/works/${w.slug}/${img.filename}`,
        });
      }
    }
  }
  return out;
}

export function workBySlug(slug: string): Work | undefined {
  return works.find((w) => w.slug === slug);
}
