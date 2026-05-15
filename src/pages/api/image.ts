import type { APIRoute } from "astro";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveContentPath } from "../../lib/content-scanner";

export const prerender = false;

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export const GET: APIRoute = async ({ url }) => {
  const rel = url.searchParams.get("path");
  if (!rel) return new Response("missing path", { status: 400 });

  const abs = resolveContentPath(rel);
  if (!abs) return new Response("invalid path", { status: 400 });

  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return new Response("not found", { status: 404 });

  const ext = path.extname(abs).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

  const stream = createReadStream(abs);
  return new Response(stream as unknown as ReadableStream, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-length": String(stat.size),
      "cache-control": "no-store",
    },
  });
};
