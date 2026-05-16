import type { APIRoute } from "astro";
import { META_KEYS, saveMeta } from "../../lib/meta-store";
import { loadTags, tagIdSet } from "../../data/tags";

export const prerender = false;

/**
 * Save handler for the works.json metadata.
 *
 * Old behavior: wrote works.json to `<projectRoot>/src/data/works.json`
 * and copied each work's images into `public/works/<slug>/`. That worked
 * locally but blew up in production with EROFS — the bundled Lambda
 * filesystem is read-only — so every save in prod returned 500.
 *
 * New behavior: just validates the payload and writes it to the
 * metadata store (Netlify Blobs in prod, filesystem in dev). Images
 * already live in the same storage layer (uploaded via /api/sync), so
 * there's nothing to copy. Public-side pages read the same key on
 * each render, which means edits appear on the site the moment
 * Nicholas hits Save — no rebuild required.
 */

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
   * directory. We accept the admin's flag rather than guessing from
   * the path shape.
   */
  isLooseFile?: boolean;
  /**
   * Whether the work appears on the public site. False = draft (still
   * persists in works.json so admin edits aren't lost, but filtered
   * out of every public listing). Defaults to true.
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

  // ---- validate slugs / required fields ----
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

  // Tags are validated against the live tag list (which lives in the
  // same metadata store now). Loading happens once per save.
  const allTags = await loadTags();
  const validTagIds = tagIdSet(allTags);

  // ---- normalize each work ----
  const outWorks: Record<string, unknown>[] = [];
  for (const w of body.works) {
    const published = w.published !== false;

    const outImages: {
      filename: string;
      sourceFile?: string;
      shown: boolean;
      featured?: boolean;
      caption?: string;
      status?: "nfs" | "sold";
    }[] = [];
    let idx = 0;
    for (const img of w.images) {
      const sourceFile =
        typeof img.sourceFile === "string" && img.sourceFile.length > 0
          ? img.sourceFile
          : undefined;
      const baseName = img.filename.split("/").pop() ?? img.filename;
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
    }

    if (outImages.length === 0 && published) {
      return jsonResponse(
        { error: `cannot save ${w.slug}: no images listed` },
        400
      );
    }

    const cleanTags = Array.isArray(w.tags)
      ? Array.from(
          new Set(
            w.tags.filter(
              (t): t is string => typeof t === "string" && validTagIds.has(t)
            )
          )
        )
      : [];

    const cleanHiddenImages = Array.isArray(w.hiddenImages)
      ? Array.from(
          new Set(
            w.hiddenImages.filter((s): s is string => typeof s === "string")
          )
        )
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

  // Log what we're about to write — surfaces in Netlify function logs.
  // Important for tracking down "I saved but it didn't persist" reports:
  // if the log shows the write happening but the next read returns
  // stale data, the bug is on the read side; if the write is missing
  // entirely, save() may not be reaching this point.
  console.log(
    `[api/save] writing ${outWorks.length} works (${outWorks.filter((w) => !w.published === false || w.published === undefined).length} published)`
  );

  try {
    await saveMeta(META_KEYS.works, { meta, works: outWorks });
    console.log("[api/save] saveMeta completed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/save] saveMeta failed:", message);
    return jsonResponse({ error: `storage error: ${message}` }, 500);
  }

  return jsonResponse({ ok: true, written: outWorks.length });
};
