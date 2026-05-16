import type { APIRoute } from "astro";
import { META_KEYS, saveMeta } from "../../lib/meta-store";

export const prerender = false;

interface IncomingGroup {
  minYear?: number | null;
  maxYear?: number | null;
}

interface SaveBody {
  groups: IncomingGroup[];
}

const MAX_GROUPS = 32;
const MIN_YEAR = 1800;
const MAX_YEAR = 2200;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function normalizeYear(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input)) return undefined;
  const n = Math.round(input);
  if (n < MIN_YEAR || n > MAX_YEAR) return undefined;
  return n;
}

/**
 * Persist year-range definitions. Same migration as save-tags: writes
 * via the meta-store (Blobs in prod, filesystem in dev) instead of
 * trying to write to the read-only Lambda bundle.
 */
export const POST: APIRoute = async ({ request }) => {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }
  if (!body || !Array.isArray(body.groups)) {
    return jsonResponse({ error: "missing groups array" }, 400);
  }
  if (body.groups.length > MAX_GROUPS) {
    return jsonResponse(
      { error: `too many groups (${body.groups.length}; max ${MAX_GROUPS})` },
      400
    );
  }

  const clean: { minYear?: number; maxYear?: number }[] = [];
  for (const g of body.groups) {
    if (!g || typeof g !== "object") {
      return jsonResponse({ error: "invalid group entry" }, 400);
    }
    const min = normalizeYear(g.minYear);
    const max = normalizeYear(g.maxYear);
    if (min === undefined && max === undefined) {
      return jsonResponse(
        { error: "each group must have a min year, a max year, or both" },
        400
      );
    }
    if (min !== undefined && max !== undefined && min > max) {
      return jsonResponse(
        { error: `min year (${min}) cannot be greater than max year (${max})` },
        400
      );
    }
    const entry: { minYear?: number; maxYear?: number } = {};
    if (min !== undefined) entry.minYear = min;
    if (max !== undefined) entry.maxYear = max;
    clean.push(entry);
  }

  try {
    await saveMeta(META_KEYS.yearGroups, { groups: clean });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/save-year-groups] saveMeta failed:", message);
    return jsonResponse({ error: `storage error: ${message}` }, 500);
  }

  return jsonResponse({ ok: true, count: clean.length });
};
