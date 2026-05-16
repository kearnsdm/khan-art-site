import type { APIRoute } from "astro";
import { contentStorage } from "../../../lib/content-storage";

export const prerender = false;

interface ManifestEntry {
  path: string;
  size: number;
}

interface ManifestBody {
  files: ManifestEntry[];
}

const MAX_ENTRIES = 5000;

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
  // No `..` segments anywhere — path traversal guard.
  const parts = key.replace(/\\/g, "/").split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === "..") return false;
    if (p.startsWith(".")) return false; // skip dotfiles
  }
  return true;
}

/**
 * Compares an incoming list of {path, size} entries against what's
 * already in content storage. Returns the subset of paths the server
 * doesn't have (or has at a different size). The browser uses this to
 * upload only what's new — avoids re-sending a 1 GB Drive folder every
 * sync.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: ManifestBody;
  try {
    body = (await request.json()) as ManifestBody;
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }
  if (!body || !Array.isArray(body.files)) {
    return jsonResponse({ error: "missing files array" }, 400);
  }
  if (body.files.length > MAX_ENTRIES) {
    return jsonResponse(
      { error: `too many files (${body.files.length}; max ${MAX_ENTRIES})` },
      400
    );
  }

  const store = contentStorage();
  const needed: string[] = [];

  for (const entry of body.files) {
    if (!entry || typeof entry !== "object") continue;
    if (!isSafeKey(entry.path)) continue;
    const incomingSize = typeof entry.size === "number" ? entry.size : 0;

    const stat = await store.stat(entry.path);
    if (!stat) {
      // Server doesn't have it yet.
      needed.push(entry.path);
      continue;
    }
    // We have it — keep it. Even if the incoming size differs (renamed,
    // re-saved, etc.), the merge contract is additive-only: we don't
    // overwrite existing files. The browser-side flow will treat a
    // size mismatch as "leave it alone, the server already has this
    // path stored."
    if (incomingSize !== stat.size) {
      // Note: not currently doing anything with this; spec says
      // additive-only. If we later want a "potential duplicate" hint,
      // surface it here.
    }
  }

  return jsonResponse({ needed });
};
