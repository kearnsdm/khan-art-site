import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import { contentStorage } from "../../lib/content-storage";
import { projectRoot } from "../../lib/content-scanner";

export const prerender = false;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

/** Reject any path that escapes the storage root via traversal or absolute paths. */
function isSafeKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  const parts = key.replace(/\\/g, "/").split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") return false;
  }
  return true;
}

/**
 * Read the bundled `public/works/<slug>/<basename>` file if it exists.
 *
 * Safety net for works that were copied into `public/works/` during the
 * test phase but whose source bytes aren't (or aren't yet) in Blobs.
 * Without this, those works would render as broken images once we
 * switched the public site to read Blobs keys.
 *
 * Read-only filesystem access works fine inside a Lambda — we just
 * can't write there. `<projectRoot>/public/works/` ships inside the
 * SSR function bundle.
 */
async function tryBundledFallback(
  key: string,
  slugHint: string | null
): Promise<Uint8Array | null> {
  // Resolve the slug we'll look under in public/works/. Order of
  // preference: explicit `slug` query param (sent by imageUrl helper),
  // then the first segment of the key when it's a slug-shaped string
  // (handles a few legacy URL shapes).
  let slug = slugHint;
  if (!slug) {
    const first = key.replace(/\\/g, "/").split("/")[0];
    if (first && /^[a-z0-9][a-z0-9-]*$/.test(first)) slug = first;
  }
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;

  const baseName = path.basename(key.replace(/\\/g, "/"));
  if (!baseName) return null;

  const abs = path.join(projectRoot(), "public", "works", slug, baseName);
  // Containment check — defense against weird inputs.
  const base = path.join(projectRoot(), "public", "works", slug);
  if (!abs.startsWith(base)) return null;
  try {
    const buf = await fs.readFile(abs);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Serve a stored content image by its storage-layer key.
 *
 * Lookup order:
 *   1. contentStorage().get(key) — Netlify Blobs in prod, FS in dev
 *   2. Bundled `public/works/<slug>/<file>` fallback — keeps legacy
 *      slug-style URLs and seeded test images resolving
 *
 * Cached for an hour client-side so repeat views don't re-fetch from
 * Blobs. Keys include filenames that already encode revisions (we
 * don't overwrite an existing key — uploads always go to a new path),
 * so a long cache is safe.
 */
export const GET: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get("path");
  if (!rel) return new Response("missing path", { status: 400 });
  if (!isSafeKey(rel)) return new Response("invalid path", { status: 400 });
  const slugHint = url.searchParams.get("slug");

  let bytes: Uint8Array | null = null;
  try {
    bytes = await contentStorage().get(rel);
  } catch (err) {
    console.error("[api/image] storage.get failed for", rel, err);
  }
  if (!bytes) {
    bytes = await tryBundledFallback(rel, slugHint);
  }
  if (!bytes) return new Response("not found", { status: 404 });

  const ext = path.extname(rel).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  // Cast through BodyInit because `Uint8Array` is technically not in the
  // BodyInit union under the strict DOM lib types Astro ships with, but
  // it's valid at runtime — Response accepts any ArrayBufferView.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
};
