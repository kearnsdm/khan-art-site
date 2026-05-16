import type { APIRoute } from "astro";
import { contentStorage } from "../../../lib/content-storage";
import { isPublishable } from "../../../lib/content-scanner";

export const prerender = false;

// Netlify Functions cap incoming request bodies at 6 MB after the
// Lambda runtime base64-encodes them (~33% inflation). So a raw 5 MB
// file becomes ~6.7 MB encoded and gets killed by the gateway with a
// generic "Internal Error" before this handler ever runs. We cap raw
// file bytes at 4 MB — that lands around 5.4 MB encoded, leaving room
// for the rest of the multipart body. The browser-side resize uses
// the same threshold, so anything bigger should arrive already
// shrunk. On a paid Netlify tier the underlying limit is much
// higher — bump this if you upgrade.
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isSafeKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;
  if (key.length > 1024) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  const parts = key.replace(/\\/g, "/").split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") return false;
    if (p.startsWith(".")) return false;
  }
  return true;
}

/**
 * Receives a single file upload and stores it under the requested path
 * in the content storage layer. Browser side calls this once per file
 * the manifest endpoint flagged as needed.
 *
 * Request: multipart/form-data with two fields:
 *   - `path`  (string)  the target storage key
 *   - `file`  (Blob)    the file content
 *
 * Path is validated against traversal. Files larger than MAX_FILE_BYTES
 * are rejected — Netlify functions cap request bodies anyway.
 *
 * Additive-only: if the path already exists, returns 200 with
 * `{ skipped: true }` and does NOT overwrite.
 */
export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: "invalid form data" }, 400);
  }

  const pathField = form.get("path");
  const fileField = form.get("file");

  if (typeof pathField !== "string") {
    return jsonResponse({ error: "missing path" }, 400);
  }
  if (!(fileField instanceof File) && !(fileField instanceof Blob)) {
    return jsonResponse({ error: "missing file" }, 400);
  }

  const key = pathField;
  if (!isSafeKey(key)) {
    return jsonResponse({ error: "invalid path" }, 400);
  }

  // Enforce the publishable-file convention server-side too: must be an
  // image extension AND filename stem must end with "web". Browser-side
  // already pre-filters, but the server is the source of truth.
  if (!isPublishable(key)) {
    return jsonResponse(
      { error: "file rejected: only images whose filename ends in 'web' are accepted" },
      400
    );
  }

  const file: Blob = fileField as Blob;
  if (file.size > MAX_FILE_BYTES) {
    return jsonResponse(
      { error: `file too large (${file.size} bytes; max ${MAX_FILE_BYTES})` },
      413
    );
  }

  const store = contentStorage();
  try {
    if (await store.has(key)) {
      // Additive-only: don't overwrite. Browser-side dedup should
      // have caught this, but enforce server-side too.
      return jsonResponse({ ok: true, skipped: true, reason: "exists" });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await store.put(key, bytes, {
      size: String(bytes.byteLength),
      lastModified: String(Date.now()),
    });

    return jsonResponse({ ok: true, written: bytes.byteLength });
  } catch (err) {
    // Anything thrown by Netlify Blobs (auth, quota, network) bubbles
    // up here. Surface the actual error message so the admin shows
    // something diagnostic instead of a generic HTTP 500.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync/upload] storage error for", key, message);
    return jsonResponse(
      { error: `storage error: ${message}` },
      500
    );
  }
};
