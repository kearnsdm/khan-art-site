import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import { projectRoot, scanContent, worksJsonPath } from "../../lib/content-scanner";
import { tags } from "../../data/tags";

export const prerender = false;

function yearGroupsJsonPath(): string {
  return path.join(projectRoot(), "src", "data", "year-groups.json");
}

export const GET: APIRoute = async () => {
  const folders = await scanContent();
  let currentWorks: unknown = [];
  let meta: unknown = { displayOrder: "year-sequence", hiddenWorks: [] };
  try {
    const raw = await fs.readFile(worksJsonPath(), "utf-8");
    const parsed = JSON.parse(raw);
    currentWorks = parsed.works ?? [];
    if (parsed.meta && typeof parsed.meta === "object") meta = parsed.meta;
  } catch {
    currentWorks = [];
  }

  // Read the live year-groups.json from disk rather than the bundled
  // import — that way the admin sees Nicholas's latest edits without
  // needing a rebuild.
  let yearGroups: { minYear?: number; maxYear?: number }[] = [];
  try {
    const raw = await fs.readFile(yearGroupsJsonPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.groups)) yearGroups = parsed.groups;
  } catch {
    yearGroups = [];
  }

  return new Response(
    JSON.stringify({ folders, currentWorks, tags, meta, yearGroups }),
    { headers: { "content-type": "application/json" } }
  );
};
