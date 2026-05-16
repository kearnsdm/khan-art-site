import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  contentRoot,
  publicWorksRoot,
  resolveContentPath,
  worksJsonPath,
} from "../../lib/content-scanner";
import { tagIds } from "../../data/tags";

export const prerender = false;

interface IncomingImage {
  filename: string;
  /** Path relative to the work's sourceFolder; falls back to filename. */
  sourceFile?: string;
  shown: boolean;
  featured?: boolean;
  caption?: string;
  status?: string | null;
}

interface IncomingWork {
  slug: string;
  title: string;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  sequence?: number | null;
  sourceFolder: string;
  /**
   * True if `sourceFolder` points at a single image file rather than a
   * directory (i.e. a loose image at the top of content/ or directly
   * inside a year folder). The admin sets this from the scanner; we
   * trust it rather than guessing from the path shape.
   */
  isLooseFile?: boolean;
  /**
   * Whether the work appears on the public site. False = draft (lives
   * in works.json so edits persist, but no images are copied to
   * public/works/ and the site filters it out). Defaults to true.
   */
  published?: boolean;
  images: IncomingImage[];
  hiddenImages?: string[];
  caption?: string;
  tags?: string[];
}

interface IncomingMeta {
  displayOrder?: string;
  hiddenWorks?: string[];
}

interface SaveBody {
  works: IncomingWork[];
  meta?: IncomingMeta;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Locate the source image and copy it into the work's destination folder.
 *
 * `sourceFile` is the path inside the work's source folder, which may
 * include subfolder segments (e.g. "Raleigh Final Photos edited/X.jpg").
 * Falls back to using `filename` as the relative path for legacy saves
 * that didn't track the subfolder position.
 */
async function copyImage(
  sourceFolderRel: string,
  filename: string,
  sourceFile: string | undefined,
  destDir: string,
  looseFile: boolean
): Promise<string | null> {
  let abs: string | null;
  if (looseFile) {
    abs = resolveContentPath(sourceFolderRel);
  } else {
    const folderAbs = resolveContentPath(sourceFolderRel);
    if (!folderAbs) return null;
    // Prefer the explicit sourceFile (handles subfolders correctly); fall
    // back to the basename for legacy data with no sourceFile recorded.
    const rel = sourceFile && sourceFile.length > 0 ? sourceFile : filename;
    abs = path.isAbsolute(rel) ? rel : path.join(folderAbs, rel);
    if (!abs.startsWith(contentRoot())) {
      const alt = resolveContentPath(rel);
      if (alt) abs = alt;
    }
  }
  if (!abs || !abs.startsWith(contentRoot())) return null;
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return null;
  const destPath = path.join(destDir, path.basename(abs));
  await fs.copyFile(abs, destPath);
  return abs;
}

export const POST: APIRoute = async ({ request }) => {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }
  if (!body || !Array.isArray(body.works)) {
    return jsonResponse({ error: "missing works array" }, 400);
  }

  // ---- validate ----
  const seenSlugs = new Set<string>();
  for (const w of body.works) {
    if (!w.slug || !SLUG_RE.test(w.slug)) {
      return jsonResponse({ error: `bad slug: ${w.slug}` }, 400);
    }
    if (seenSlugs.has(w.slug)) {
      return jsonResponse({ error: `duplicate slug: ${w.slug}` }, 400);
    }
    seenSlugs.add(w.slug);
    if (!w.title) {
      return jsonResponse({ error: `work ${w.slug} missing title` }, 400);
    }
    if (!w.sourceFolder) {
      return jsonResponse({ error: `work ${w.slug} missing sourceFolder` }, 400);
    }
    if (!Array.isArray(w.images) || w.images.length === 0) {
      return jsonResponse(
        { error: `work ${w.slug} has no images selected` },
        400
      );
    }
  }

  const pubWorks = publicWorksRoot();
  await fs.mkdir(pubWorks, { recursive: true });

  // Only published works have images on the public side. Drafts (their
  // metadata still saves to works.json) get their public/works/<slug>/
  // pruned along with anything no longer in the payload.
  const publishedSlugs = new Set(
    body.works.filter((w) => w.published !== false).map((w) => w.slug)
  );

  // ---- prune slug folders not in the current published set ----
  const existingSlugDirs = await fs.readdir(pubWorks).catch(() => []);
  for (const dir of existingSlugDirs) {
    if (!publishedSlugs.has(dir)) {
      await fs.rm(path.join(pubWorks, dir), { recursive: true, force: true });
    }
  }

  // ---- write each work ----
  const outWorks: Record<string, unknown>[] = [];
  for (const w of body.works) {
    const published = w.published !== false;
    // Only published works get their images copied into public/works/.
    // Drafts still persist their metadata + image references to works.json,
    // so Nicholas's edits aren't lost between sessions.
    const destDir = path.join(pubWorks, w.slug);
    if (published) {
      await fs.mkdir(destDir, { recursive: true });
    }

    // Prefer the admin's explicit flag. Fall back to a heuristic only for
    // very old payloads that didn't include `isLooseFile`.
    const looseFile =
      typeof w.isLooseFile === "boolean"
        ? w.isLooseFile
        : !w.sourceFolder.includes("/") && /\.[a-z0-9]+$/i.test(w.sourceFolder);

    const outImages: {
      filename: string;
      sourceFile?: string;
      shown: boolean;
      featured?: boolean;
      caption?: string;
      status?: "nfs" | "sold";
    }[] = [];
    const keep = new Set<string>();
    let idx = 0;
    for (const img of w.images) {
      const sourceFile =
        typeof img.sourceFile === "string" && img.sourceFile.length > 0
          ? img.sourceFile
          : undefined;
      // Drafts: record image metadata but don't copy the bytes. Saves
      // disk / Blobs traffic when Nicholas is just iterating on titles.
      if (!published) {
        const baseName = path.basename(img.filename);
        const shown = idx === 0 ? true : img.shown !== false;
        const featured = !!img.featured && shown;
        const captionTrim =
          typeof img.caption === "string" && img.caption.trim().length > 0
            ? img.caption.trim()
            : undefined;
        let status: "nfs" | "sold" | undefined;
        if (img.status === "nfs" || img.status === "sold") status = img.status;
        const entry: typeof outImages[number] = { filename: baseName, shown };
        if (sourceFile && sourceFile !== baseName) entry.sourceFile = sourceFile;
        if (featured) entry.featured = true;
        if (captionTrim) entry.caption = captionTrim;
        if (status) entry.status = status;
        outImages.push(entry);
        idx++;
        continue;
      }
      const copied = await copyImage(
        w.sourceFolder,
        img.filename,
        sourceFile,
        destDir,
        looseFile
      );
      if (!copied) {
        idx++;
        continue;
      }
      const baseName = path.basename(copied);
      const shown = idx === 0 ? true : img.shown !== false;
      // featured implies shown — if shown is false, drop featured.
      const featured = !!img.featured && shown;
      const captionTrim =
        typeof img.caption === "string" && img.caption.trim().length > 0
          ? img.caption.trim()
          : undefined;
      let status: "nfs" | "sold" | undefined;
      if (img.status === "nfs" || img.status === "sold") status = img.status;
      const entry: typeof outImages[number] = { filename: baseName, shown };
      // Persist sourceFile so we can re-find this same image on subsequent
      // saves even if it lives in a subfolder.
      if (sourceFile && sourceFile !== baseName) entry.sourceFile = sourceFile;
      if (featured) entry.featured = true;
      if (captionTrim) entry.caption = captionTrim;
      if (status) entry.status = status;
      outImages.push(entry);
      keep.add(baseName);
      idx++;
    }

    if (outImages.length === 0 && published) {
      return jsonResponse(
        { error: `cannot read any images for ${w.slug}` },
        400
      );
    }

    // Remove stray files in destDir that aren't in the new image list.
    // Only runs for published works — drafts don't have a destDir.
    if (published) {
      const destFiles = await fs.readdir(destDir).catch(() => []);
      for (const f of destFiles) {
        if (!keep.has(f)) {
          await fs.unlink(path.join(destDir, f)).catch(() => {});
        }
      }
    }

    const cleanTags = Array.isArray(w.tags)
      ? Array.from(
          new Set(
            w.tags.filter((t): t is string => typeof t === "string" && tagIds.has(t))
          )
        )
      : [];

    const cleanHiddenImages = Array.isArray(w.hiddenImages)
      ? Array.from(new Set(w.hiddenImages.filter((s): s is string => typeof s === "string")))
      : [];

    const out: Record<string, unknown> = {
      slug: w.slug,
      title: w.title,
      sourceFolder: w.sourceFolder.startsWith("content/")
        ? w.sourceFolder
        : `content/${w.sourceFolder}`,
      // Only write `published: false` when it's actually false — keeps
      // works.json tidy. Default-true is implied by absence.
      ...(published ? {} : { published: false }),
      images: outImages,
      hiddenImages: cleanHiddenImages,
      tags: cleanTags,
    };

    if (typeof w.year === "number" && Number.isFinite(w.year)) {
      out.year = Math.max(0, Math.round(w.year));
    }
    if (typeof w.month === "number" && Number.isFinite(w.month)) {
      out.month = clamp(Math.round(w.month), 1, 12);
    }
    if (typeof w.day === "number" && Number.isFinite(w.day)) {
      out.day = clamp(Math.round(w.day), 1, 31);
    }
    if (typeof w.sequence === "number" && Number.isFinite(w.sequence)) {
      out.sequence = Math.max(0, Math.round(w.sequence));
    }
    if (typeof w.caption === "string" && w.caption.trim().length > 0) {
      out.caption = w.caption.trim();
    }

    outWorks.push(out);
  }

  // Stable sort for nice diffs: newest year first, then sequence/month, title.
  outWorks.sort((a, b) => {
    const ay = (a.year as number) ?? 0;
    const by = (b.year as number) ?? 0;
    if (ay !== by) return by - ay;
    const aSeq = (a.sequence as number) ?? (a.month as number) ?? 0;
    const bSeq = (b.sequence as number) ?? (b.month as number) ?? 0;
    if (aSeq !== bSeq) return bSeq - aSeq;
    return String(a.title).localeCompare(String(b.title));
  });

  // Normalize the meta object.
  const incomingMeta = body.meta ?? {};
  const meta = {
    displayOrder:
      incomingMeta.displayOrder === "year-month" ||
      incomingMeta.displayOrder === "year-sequence"
        ? incomingMeta.displayOrder
        : "year-sequence",
    hiddenWorks: Array.isArray(incomingMeta.hiddenWorks)
      ? Array.from(
          new Set(
            incomingMeta.hiddenWorks.filter(
              (s): s is string => typeof s === "string" && s.length > 0
            )
          )
        )
      : [],
  };

  await fs.writeFile(
    worksJsonPath(),
    JSON.stringify({ meta, works: outWorks }, null, 2) + "\n",
    "utf-8"
  );

  return jsonResponse({ ok: true, written: outWorks.length });
};
