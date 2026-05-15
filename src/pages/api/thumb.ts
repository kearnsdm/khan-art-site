import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { projectRoot, resolveContentPath } from "../../lib/content-scanner";

export const prerender = false;

const CACHE_DIR = path.join(projectRoot(), ".cache", "thumbs");
const DEFAULT_SIZE = 600;
const MAX_SIZE = 1200;

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export const GET: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get("path");
  if (!rel) return new Response("missing path", { status: 400 });

  const abs = resolveContentPath(rel);
  if (!abs) return new Response("invalid path", { status: 400 });

  const sizeParam = parseInt(url.searchParams.get("size") || `${DEFAULT_SIZE}`, 10);
  const size = Math.min(Math.max(80, isFinite(sizeParam) ? sizeParam : DEFAULT_SIZE), MAX_SIZE);

  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return new Response("not found", { status: 404 });

  const cacheKey = crypto
    .createHash("sha1")
    .update(`${abs}|${stat.size}|${stat.mtimeMs}|${size}`)
    .digest("hex");
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.jpg`);

  let cached = await fs.stat(cachePath).catch(() => null);
  if (!cached) {
    await ensureCacheDir();
    try {
      await sharp(abs, { failOn: "none" })
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
