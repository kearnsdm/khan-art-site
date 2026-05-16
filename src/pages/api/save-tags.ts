import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import { projectRoot } from "../../lib/content-scanner";

export const prerender = false;

interface IncomingTag {
  id: string;
  label: string;
  inNav?: boolean;
}

interface SaveBody {
  tags: IncomingTag[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_TAGS = 64;

function tagsJsonPath(): string {
  return path.join(projectRoot(), "src", "data", "tags.json");
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }
  if (!body || !Array.isArray(body.tags)) {
    return jsonResponse({ error: "missing tags array" }, 400);
  }
  if (body.tags.length > MAX_TAGS) {
    return jsonResponse({ error: `too many tags (${body.tags.length}; max ${MAX_TAGS})` }, 400);
  }

  const seen = new Set<string>();
  const clean: IncomingTag[] = [];
  for (const t of body.tags) {
    if (!t || typeof t.id !== "string" || typeof t.label !== "string") {
      return jsonResponse({ error: "invalid tag entry" }, 400);
    }
    if (!SLUG_RE.test(t.id)) {
      return jsonResponse({ error: `bad tag id: ${t.id}` }, 400);
    }
    if (seen.has(t.id)) {
      return jsonResponse({ error: `duplicate tag id: ${t.id}` }, 400);
    }
    const label = t.label.trim();
    if (!label) {
      return jsonResponse({ error: `tag ${t.id} has empty label` }, 400);
    }
    if (label.length > 60) {
      return jsonResponse({ error: `tag label too long: ${label}` }, 400);
    }
    seen.add(t.id);
    const entry: IncomingTag = { id: t.id, label };
    if (t.inNav === true) entry.inNav = true;
    clean.push(entry);
  }

  await fs.writeFile(
    tagsJsonPath(),
    JSON.stringify({ tags: clean }, null, 2) + "\n",
    "utf-8"
  );

  return jsonResponse({ ok: true, count: clean.length });
};
