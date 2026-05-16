import type { APIRoute } from "astro";
import { scanContent } from "../../lib/content-scanner";
import { loadMetaWithFallback, META_KEYS } from "../../lib/meta-store";
import { loadTags } from "../../data/tags";
import bundledWorks from "../../data/works.json";
import bundledGroups from "../../data/year-groups.json";

export const prerender = false;

/**
 * Aggregate payload for the admin /admin/works UI. Returns the result
 * of scanning storage for content folders, plus the current persisted
 * works/tags/year-groups (all from the metadata store — same source
 * the public site reads, so admin and public stay in lockstep).
 */
export const GET: APIRoute = async () => {
  const folders = await scanContent();

  const worksDoc = await loadMetaWithFallback<{
    works: unknown[];
    meta?: unknown;
  }>(META_KEYS.works, bundledWorks as unknown as { works: unknown[]; meta?: unknown });
  const currentWorks = Array.isArray(worksDoc?.works) ? worksDoc.works : [];
  const meta =
    worksDoc?.meta && typeof worksDoc.meta === "object"
      ? worksDoc.meta
      : { displayOrder: "year-sequence", hiddenWorks: [] };

  const groupsDoc = await loadMetaWithFallback<{ groups: unknown[] }>(
    META_KEYS.yearGroups,
    bundledGroups as unknown as { groups: unknown[] }
  );
  const yearGroups = Array.isArray(groupsDoc?.groups) ? groupsDoc.groups : [];

  const tags = await loadTags();

  return new Response(
    JSON.stringify({ folders, currentWorks, tags, meta, yearGroups }),
    { headers: { "content-type": "application/json" } }
  );
};
