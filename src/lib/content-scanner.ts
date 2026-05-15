import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONTENT_ROOT = path.join(PROJECT_ROOT, "content");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff"]);

export interface ScannedFile {
  name: string;
  relPath: string;
  isImage: boolean;
  size: number;
}

export interface ScannedFolder {
  name: string;
  relPath: string;
  guessedSlug: string;
  guessedTitle: string;
  guessedYear: number | null;
  guessedSection: string | null;
  files: ScannedFile[];
}

export function projectRoot(): string {
  return PROJECT_ROOT;
}

export function contentRoot(): string {
  return CONTENT_ROOT;
}

export function publicWorksRoot(): string {
  return path.join(PROJECT_ROOT, "public", "works");
}

export function worksJsonPath(): string {
  return path.join(PROJECT_ROOT, "src", "data", "works.json");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function guessFromFolderName(folderName: string): {
  title: string;
  year: number | null;
  slug: string;
  section: string | null;
} {
  // Matches "2025.26_The Seven Sisters", "2025.27 High Wires", "2025.1_Sophia Plowright portrait"
  const match = folderName.match(/^(\d{4})\.\s*(\d+)\s*[_\s]\s*(.+)$/);
  let year: number | null = null;
  let title = folderName;
  if (match) {
    year = parseInt(match[1], 10);
    title = match[3].trim();
  } else {
    const yearOnly = folderName.match(/^(\d{4})[._\s-]+(.+)$/);
    if (yearOnly) {
      year = parseInt(yearOnly[1], 10);
      title = yearOnly[2].trim();
    }
  }
  return { title, year, slug: slugify(title), section: yearToSection(year) };
}

export function yearToSection(year: number | null): string | null {
  if (year == null) return null;
  if (year === 2026) return "paintings-2026";
  if (year === 2025) return "paintings-2025";
  if (year >= 2021 && year <= 2024) return "paintings-2021-2024";
  if (year <= 2020) return "paintings-before-2021";
  return null;
}

async function readDirSafe(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

export async function scanContent(): Promise<ScannedFolder[]> {
  const folders: ScannedFolder[] = [];
  const yearDirs = await readDirSafe(CONTENT_ROOT);

  for (const yearDir of yearDirs) {
    const yearPath = path.join(CONTENT_ROOT, yearDir);
    const yearStat = await fs.stat(yearPath).catch(() => null);
    if (!yearStat?.isDirectory()) continue;

    const workDirs = await readDirSafe(yearPath);
    for (const workDir of workDirs) {
      if (workDir.toLowerCase() === "invoices") continue;
      const workPath = path.join(yearPath, workDir);
      const workStat = await fs.stat(workPath).catch(() => null);
      if (!workStat?.isDirectory()) continue;

      const files = await collectFiles(workPath, path.join(yearDir, workDir));
      const guess = guessFromFolderName(workDir);
      folders.push({
        name: workDir,
        relPath: path.join(yearDir, workDir).replace(/\\/g, "/"),
        guessedSlug: guess.slug || slugify(workDir),
        guessedTitle: guess.title,
        guessedYear: guess.year,
        guessedSection: guess.section,
        files,
      });
    }
  }

  folders.sort((a, b) => {
    const ay = a.guessedYear ?? 0;
    const by = b.guessedYear ?? 0;
    if (ay !== by) return by - ay;
    return a.name.localeCompare(b.name);
  });

  return folders;
}

async function collectFiles(absDir: string, relDir: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subFiles = await collectFiles(path.join(absDir, entry.name), path.join(relDir, entry.name));
      out.push(...subFiles);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (entry.name.startsWith(".")) continue;
    const absPath = path.join(absDir, entry.name);
    const stat = await fs.stat(absPath).catch(() => null);
    out.push({
      name: entry.name,
      relPath: path.join(relDir, entry.name).replace(/\\/g, "/"),
      isImage: IMAGE_EXTS.has(ext),
      size: stat?.size ?? 0,
    });
  }
  return out;
}

export function resolveContentPath(relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(CONTENT_ROOT, normalized);
  if (!abs.startsWith(CONTENT_ROOT + path.sep) && abs !== CONTENT_ROOT) {
    return null;
  }
  return abs;
}
