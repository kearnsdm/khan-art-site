import type { APIRoute } from "astro";
import path from "node:path";
import { contentStorage } from "../../lib/content-storage";

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

/**
 * Serve a stored content image by its path within the storage layer.
 * In local dev this reads from the filesystem; in production it reads
 * from Netlify Blobs. Either way, the path is the same forward-slashed
 * key the scanner uses.
 */
export const GET: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get("path");
  if (!rel) return new Response("missing path", { status: 400 });

  const store = contentStorage();
  const bytes = await store.get(rel);
  if (!bytes) return new Response("not found", { status: 404 });

  const ext = path.extname(rel).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
    },
  });
};
