import type { APIRoute } from "astro";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  contentRoot,
  publicWorksRoot,
  resolveContentPath,
  worksJsonPath,
} from "../../lib/content-scanner";

export const prerender = false;

interface IncomingWork {
  slug: string;
  title: string;
  year: number;
  section: string;
  featured?: boolean;
  sourceFolder: string;
  primaryImage: string;
  additionalImages?: string[];
}

interface SaveBody {
  works: IncomingWork[];
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export const POST: APIRoute = async ({ request }) => {
  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  if (!body || !Array.isArray(body.works)) {
    return json({ error: "missing works array" }, 400);
  }

  const seenSlugs = new Set<string>();
  for (const w of body.works) {
    if (!w.slug || !SLUG_RE.test(w.slug)) return json({ error: `bad slug: ${w.slug}` }, 400);
    if (seenSlugs.has(w.slug)) return json({ error: `duplicate slug: ${w.slug}` }, 400);
    seenSlugs.add(w.slug);
    if (!w.title || !w.section) return json({ error: `work ${w.slug} missing title/section` }, 400);
    if (!w.sourceFolder) return json({ error: `work ${w.slug} missing sourceFolder` }, 400);
    if (!w.primaryImage) return json({ error: `work ${w.slug} missing primaryImage` }, 400);
  }

  const pubWorks = publicWorksRoot();
  await fs.mkdir(pubWorks, { recursive: true });

  // Remove slug folders that are no longer present
  const existingSlugDirs = await fs.readdir(pubWorks).catch(() => []);
  for (const dir of existingSlugDirs) {
    if (!seenSlugs.has(dir)) {
      await fs.rm(path.join(pubWorks, dir), { recursive: true, force: true });
    }
  }

  const outWorks = [];
  for (const w of body.works) {
    const destDir = path.join(pubWorks, w.slug);
    await fs.mkdir(destDir, { recursive: true });

    const filesToKeep = new Set<string>();
    const additional = w.additionalImages ?? [];

    const primarySrc = await copyImage(w.sourceFolder, w.primaryImage, destDir);
    if (!primarySrc) return json({ error: `cannot read primary image for ${w.slug}` }, 400);
    filesToKeep.add(path.basename(primarySrc));

    const additionalPaths: string[] = [];
    for (const a of additional) {
      const copied = await copyImage(w.sourceFolder, a, destDir);
      if (!copied) continue;
      filesToKeep.add(path.basename(copied));
      additionalPaths.push(`/works/${w.slug}/${path.basename(copied)}`);
    }

    // Remove files in destDir that aren't kept
    const destFiles = await fs.readdir(destDir).catch(() => []);
    for (const f of destFiles) {
      if (!filesToKeep.has(f)) {
        await fs.unlink(path.join(destDir, f)).catch(() => {});
      }
    }

    outWorks.push({
      slug: w.slug,
      title: w.title,
      year: w.year,
      section: w.section,
      featured: !!w.featured,
      sourceFolder: `content/${w.sourceFolder}`.replace(/\/+/g, "/"),
      primaryImage: `/works/${w.slug}/${path.basename(primarySrc)}`,
      primaryImageAlt: `${w.title} painting`,
      additionalImages: additionalPaths,
    });
  }

  const json5 = { works: outWorks };
  await fs.writeFile(worksJsonPath(), JSON.stringify(json5, null, 2) + "\n", "utf-8");

  return json({ ok: true, written: outWorks.length });
};

async function copyImage(sourceFolderRel: string, fileName: string, destDir: string): Promise<string | null> {
  const folderAbs = resolveContentPath(sourceFolderRel);
  if (!folderAbs) return null;
  // file path may itself be relative to content root (e.g. nested), or just the bare filename
  let abs = path.isAbsolute(fileName)
    ? fileName
    : path.join(folderAbs, fileName);
  // If the given fileName starts with the sourceFolder prefix, treat it as already relative-to-content
  if (!abs.startsWith(contentRoot())) {
    const alt = resolveContentPath(fileName);
    if (alt) abs = alt;
  }
  if (!abs.startsWith(contentRoot())) return null;
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat?.isFile()) return null;
  const destPath = path.join(destDir, path.basename(abs));
  await fs.copyFile(abs, destPath);
  return abs;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
