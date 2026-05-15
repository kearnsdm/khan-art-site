import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import { scanContent, worksJsonPath } from "../../lib/content-scanner";

export const prerender = false;

export const GET: APIRoute = async () => {
  const folders = await scanContent();
  let currentWorks: unknown = [];
  try {
    const raw = await fs.readFile(worksJsonPath(), "utf-8");
    const parsed = JSON.parse(raw);
    currentWorks = parsed.works ?? [];
  } catch {
    currentWorks = [];
  }
  return new Response(
    JSON.stringify({ folders, currentWorks }),
    { headers: { "content-type": "application/json" } }
  );
};
