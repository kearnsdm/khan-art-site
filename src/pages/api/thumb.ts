import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { projectRoot } from "../../lib/content-scanner";
import { contentStorage, usingBlobs } from "../../lib/content-storage";

export const prerender = false;

const CACHE_DIR = path.join(projectRoot(), ".cache", "thumbs");
const DEFAULT_SIZE = 600;
const MAX_SIZE = 1200;

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

/**
 * Generate (and cache) a JPEG thumbnail for a stored image. Reads from
 * the content storage layer (Blobs in prod, filesystem in dev), runs
 * the bytes through sharp, and caches the result under .cache/thumbs/.
 *
 * In production, the disk cache is ephemeral (Netlify functions have a
 * read-write tmpfs for the lifetime of the function instance) but
 * survives within a warm function so repeated views are still fast.
 */
export const GET: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get("path");
  if (!rel) return new Response("missing path", { status: 400 });

  const sizeParam = parseInt(url.searchParams.get("size") || `${DEFAULT_SIZE}`, 10);
  const size = Math.min(Math.max(80, isFinite(sizeParam) ? sizeParam : DEFAULT_SIZE), MAX_SIZE);

  const store = contentStorage();
  const stat = await store.stat(rel);
  if (!stat) return new Response("not found", { status: 404 });

  const cacheKey = crypto
    .createHash("sha1")
    .update(`${rel}|${stat.size}|${stat.lastModified ?? 0}|${size}|${usingBlobs() ? "b" : "f"}`)
    .digest("hex");
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.jpg`);

  let cached = await fs.stat(cachePath).catch(() => null);
  if (!cached) {
    await ensureCacheDir();
    try {
      const bytes = await store.get(rel);
      if (!bytes) return new Response("not found", { status: 404 });
      await sharp(bytes, { failOn: "none" })
        .rotate()
        .resize(size, size, { fit: "cover", withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toFile(cachePath);
      cached = await fs.stat(cachePath);
    } catch (e) {
      return new Response("thumb failed: " + (e as Error).message, { status: 500 });
    }
  }

  const stream = createReadStream(cachePath);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(cached.size),
      "cache-control": "public, max-age=3600",
    },
  });
};
