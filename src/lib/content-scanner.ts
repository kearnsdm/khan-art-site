import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentStorage, usingBlobs } from "./content-storage";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Read CONTENT_ROOT from the environment so Devin can point the scanner
 * at a Google-Drive-synced folder (or any external location) without
 * needing a filesystem symlink. We accept both `process.env` and Vite's
 * `import.meta.env`, since Astro's dev server populates the latter but
 * not always the former.
 *
 * Falls back to <project>/content for the default in-repo setup.
 */
function readContentRoot(): string {
  if (typeof process !== "undefined") {
    const fromProcess = process.env?.CONTENT_ROOT;
    if (fromProcess && fromProcess.length > 0) return fromProcess;
  }
  // @ts-expect-error import.meta.env shape is provided by Vite at runtime
  const fromMeta = import.meta.env?.CONTENT_ROOT as string | undefined;
  if (fromMeta && fromMeta.length > 0) return fromMeta;
  return path.join(PROJECT_ROOT, "content");
}

const CONTENT_ROOT = readContentRoot();

const IMAGE_EXTS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".heic", ".heif",
]);

/**
 * Convention for which files are imported into the picker:
 *   - Must be an image extension (`IMAGE_EXTS`)
 *   - Filename stem (before extension) must end with the marker "web"
 *     PRECEDED BY A SEPARATOR — case-insensitive. The required separator
 *     prevents accidental matches against generic names like Photoshop's
 *     default "Web.png" save-for-web output.
 *
 *   Painting_web.jpg          ✓  underscore separator
 *   Painting-web.jpg          ✓  hyphen separator
 *   Painting web.jpg          ✓  space separator
 *   Painting.web.jpg          ✓  dot separator
 *   Painting_Final_WEB.JPG    ✓  case-insensitive
 *   Painting_web.webp         ✓  (.webp extension is unrelated)
 *   Web.png                   ✗  starts with "Web", no separator before
 *   Paintingweb.jpg           ✗  no separator before "web"
 *   Painting_webcam.jpg       ✗  doesn't end with "web"
 *   Painting.jpg              ✗  no marker
 *
 * Anything else stays on Drive but never enters the site's storage.
 */
const WEB_SUFFIX_RE = /[_\-\s.]web$/i;

export function isPublishable(filename: string): boolean {
  const baseName = filename.split(/[\\/]/).pop() ?? filename;
  const dot = baseName.lastIndexOf(".");
  const ext = dot >= 0 ? baseName.slice(dot).toLowerCase() : "";
  const stem = dot >= 0 ? baseName.slice(0, dot) : baseName;
  if (!IMAGE_EXTS.has(ext)) return false;
  return WEB_SUFFIX_RE.test(stem);
}

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
  guessedMonth: number | null;
  guessedDay: number | null;
  guessedSequence: number | null;
  guessedSection: string | null;
  /** Single loose image at the top of content/ that doesn't live in a folder. */
  isLooseFile: boolean;
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

export interface ParsedName {
  title: string;
  year: number | null;
  month: number | null;
  day: number | null;
  sequence: number | null;
  slug: string;
  section: string | null;
}

/**
 * Try to extract a year + ordering hint from a folder or file name.
 *
 * Patterns we recognize, in priority order:
 *
 *   YYYY.MM.DD_Title    → year + month (1..12) + day (1..31) + title
 *   YYYY.MM-DD_Title    → same, alternative separator
 *   YYYY.SEQ_Title      → year + sequence  (if SEQ > 12 it's clearly not a month)
 *                        (if SEQ ≤ 12 it's ambiguous; we guess sequence — most
 *                         of Nicholas's existing folders use sequence rather
 *                         than month, and a date without a day is unusual.)
 *   YYYY_Title          → year + title, no ordering
 *   Anything else        → no year, no order, title = the raw stem
 *
 * Names that obviously look like raw camera imports (IMG_3435, DSC03241,
 * etc.) get no parsed fields at all — title is left empty so the admin
 * shows it blank and Nicholas is prompted to fill it in.
 */
export function guessFromFolderName(folderName: string): ParsedName {
  const empty: ParsedName = {
    title: folderName,
    year: null,
    month: null,
    day: null,
    sequence: null,
    slug: slugify(folderName),
    section: null,
  };

  // Camera-style names — no parseable info, leave title blank-ish.
  if (/^(IMG|DSC|PXL|DCIM|MVIMG|VID)[ _-]?\d+/i.test(folderName)) {
    return {
      title: "",
      year: null,
      month: null,
      day: null,
      sequence: null,
      slug: "",
      section: null,
    };
  }

  // YYYY.MM.DD_Title (or YYYY-MM-DD_Title, YYYY.MM-DD_Title, etc.)
  const ymd = folderName.match(
    /^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})[_\s.\-]+(.+)$/
  );
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const m = parseInt(ymd[2], 10);
    const d = parseInt(ymd[3], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const title = ymd[4].trim();
      return {
        title,
        year: y,
        month: m,
        day: d,
        sequence: null,
        slug: slugify(title),
        section: yearToSection(y),
      };
    }
  }

  // YYYY.NN_Title — either sequence (NN > 12) or ambiguous (NN ≤ 12 → sequence).
  const yn = folderName.match(/^(\d{4})\.\s*(\d+)\s*[_\s]\s*(.+)$/);
  if (yn) {
    const y = parseInt(yn[1], 10);
    const n = parseInt(yn[2], 10);
    const title = yn[3].trim();
    // n > 12 is clearly a sequence number, not a month. n ≤ 12 is
    // technically ambiguous but we choose sequence because that's how
    // Nicholas has historically numbered things.
    return {
      title,
      year: y,
      month: null,
      day: null,
      sequence: n,
      slug: slugify(title),
      section: yearToSection(y),
    };
  }

  // YYYY_Title — bare year prefix.
  const yOnly = folderName.match(/^(\d{4})[._\s-]+(.+)$/);
  if (yOnly) {
    const y = parseInt(yOnly[1], 10);
    const title = yOnly[2].trim();
    return {
      title,
      year: y,
      month: null,
      day: null,
      sequence: null,
      slug: slugify(title),
      section: yearToSection(y),
    };
  }

  return empty;
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

/**
 * Walk `content/` and surface every Work group it contains. Each Work
 * group can come from one of three shapes:
 *
 *   1. A "year folder" containing per-work subfolders. This is the
 *      historical layout (`content/2025/2025.26_Title/...`). Each
 *      subfolder is one Work group.
 *
 *   2. A top-level folder directly under `content/` whose name does
 *      NOT look like a four-digit year. This is the simple "drop a
 *      named folder anywhere" layout. The folder is one Work group.
 *
 *   3. A loose image directly under `content/`. Becomes its own Work
 *      group containing just that one image.
 *
 * The scanner is permissive: any folder name is accepted, any depth is
 * tolerated. A folder named "Invoices" (case-insensitive) is skipped
 * to avoid pulling Nicholas's bookkeeping into the picker.
 */
export async function scanContent(): Promise<ScannedFolder[]> {
  // In production (Netlify) the scanner reads from Blobs storage; in
  // dev it walks CONTENT_ROOT on disk. Both produce the same shape.
  if (usingBlobs()) {
    return scanContentFromBlobs();
  }
  return scanContentFromFilesystem();
}

async function scanContentFromFilesystem(): Promise<ScannedFolder[]> {
  const folders: ScannedFolder[] = [];
  const topEntries = await fs.readdir(CONTENT_ROOT, { withFileTypes: true }).catch(() => []);

  for (const entry of topEntries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.toLowerCase() === "invoices") continue;

    const entryPath = path.join(CONTENT_ROOT, entry.name);

    if (entry.isFile()) {
      // Shape 3: a loose top-level image becomes its own Work group.
      if (!isPublishable(entry.name)) continue;
      const stat = await fs.stat(entryPath).catch(() => null);
      if (!stat?.isFile()) continue;
      const guess = guessFromFolderName(path.parse(entry.name).name);
      folders.push({
        name: entry.name,
        relPath: entry.name,
        guessedSlug: guess.slug,
        guessedTitle: guess.title,
        guessedYear: guess.year,
        guessedMonth: guess.month,
        guessedDay: guess.day,
        guessedSequence: guess.sequence,
        guessedSection: guess.section,
        isLooseFile: true,
        files: [
          {
            name: entry.name,
            relPath: entry.name,
            isImage: true,
            size: stat.size,
          },
        ],
      });
      continue;
    }

    if (!entry.isDirectory()) continue;

    // Decide which shape this folder is: a year-folder (Shape 1) or a
    // regular Work folder (Shape 2). A year-folder is one whose name is
    // exactly a four-digit year *and* whose immediate children are all
    // directories that look like Work folders.
    // A "year folder" is one whose name is a 4-digit year, optionally
    // followed by " and earlier" or " and later" (case-insensitive).
    // This covers e.g. `2025/` plus catch-all folders like
    // `2018 and earlier/` for older works whose specific year is unknown.
    // Works inside such a folder inherit the captured year if their own
    // name doesn't supply one.
    const yearFolderMatch = entry.name.match(/^(\d{4})(?:\s+and\s+(?:earlier|later))?$/i);
    if (yearFolderMatch) {
      const yearNumber = parseInt(yearFolderMatch[1], 10);
      const yearSection = yearToSection(Number.isFinite(yearNumber) ? yearNumber : null);
      const children = await fs.readdir(entryPath, { withFileTypes: true }).catch(() => []);
      let pushedAny = false;
      for (const c of children) {
        if (c.name.startsWith(".")) continue;
        if (c.name.toLowerCase() === "invoices") continue;

        const childAbs = path.join(entryPath, c.name);
        const childRel = path.join(entry.name, c.name).replace(/\\/g, "/");

        if (c.isDirectory()) {
          // Subfolder inside the year folder → one Work group, *iff* it
          // has at least one publishable image. Folders that contain
          // only progress photos / references / non-image files are
          // skipped entirely rather than appearing as empty Works.
          const files = await collectFiles(childAbs, path.join(entry.name, c.name));
          if (files.length === 0) continue;
          const guess = guessFromFolderName(c.name);
          // Subfolder may not parse a year of its own — inherit the parent's.
          const inheritedYear = guess.year ?? yearNumber;
          folders.push({
            name: c.name,
            relPath: childRel,
            guessedSlug: guess.slug || slugify(c.name),
            guessedTitle: guess.title || c.name,
            guessedYear: Number.isFinite(inheritedYear) ? inheritedYear : null,
            guessedMonth: guess.month,
            guessedDay: guess.day,
            guessedSequence: guess.sequence,
            guessedSection: guess.section ?? yearSection,
            isLooseFile: false,
            files,
          });
          pushedAny = true;
          continue;
        }

        if (c.isFile()) {
          // Loose image directly inside the year folder → its own one-image
          // Work group. Year is inherited from the parent year folder.
          if (!isPublishable(c.name)) continue;
          const stat = await fs.stat(childAbs).catch(() => null);
          if (!stat?.isFile()) continue;
          const stem = path.parse(c.name).name;
          const guess = guessFromFolderName(stem);
          const inheritedYear = guess.year ?? yearNumber;
          folders.push({
            name: c.name,
            relPath: childRel,
            guessedSlug: guess.slug || slugify(stem),
            guessedTitle: guess.title || stem,
            guessedYear: Number.isFinite(inheritedYear) ? inheritedYear : null,
            guessedMonth: guess.month,
            guessedDay: guess.day,
            guessedSequence: guess.sequence,
            guessedSection: guess.section ?? yearSection,
            isLooseFile: true,
            files: [
              {
                name: c.name,
                relPath: childRel,
                isImage: true,
                size: stat.size,
              },
            ],
          });
          pushedAny = true;
        }
      }
      if (pushedAny) continue;
      // Empty year folder: fall through to Shape 2 (treat the year folder
      // itself as a single Work group). Rare; only happens if it has
      // neither subfolders nor loose images.
    }

    // Shape 2: ordinary top-level Work folder. Same rule — skip if it
    // contains no publishable images.
    const files = await collectFiles(entryPath, entry.name);
    if (files.length === 0) continue;
    const guess = guessFromFolderName(entry.name);
    folders.push({
      name: entry.name,
      relPath: entry.name,
      guessedSlug: guess.slug || slugify(entry.name),
      guessedTitle: guess.title || entry.name,
      guessedYear: guess.year,
      guessedMonth: guess.month,
      guessedDay: guess.day,
      guessedSequence: guess.sequence,
      guessedSection: guess.section,
      isLooseFile: false,
      files,
    });
  }

  folders.sort((a, b) => {
    const ay = a.guessedYear ?? 0;
    const by = b.guessedYear ?? 0;
    if (ay !== by) return by - ay;
    const aSeq = a.guessedSequence ?? 0;
    const bSeq = b.guessedSequence ?? 0;
    if (aSeq !== bSeq) return bSeq - aSeq;
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
    if (entry.name.startsWith(".")) continue;
    // Only include files matching the publishable convention: image
    // extension AND filename stem ends with "web". Everything else
    // (progress photos, references, non-image working files) is skipped.
    if (!isPublishable(entry.name)) continue;
    const absPath = path.join(absDir, entry.name);
    const stat = await fs.stat(absPath).catch(() => null);
    out.push({
      name: entry.name,
      relPath: path.join(relDir, entry.name).replace(/\\/g, "/"),
      isImage: true,
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

// ---------- Blobs scanner (production) ----------

/**
 * Build the same ScannedFolder[] shape from a flat list of Blobs keys
 * instead of walking a filesystem. Keys look like
 * "2025/2025.31_The Portal/IMG_0293.PNG" — same forward-slashed paths
 * the filesystem scanner produces.
 *
 * We group keys by their top-level prefix so the same Shape-1/2/3 logic
 * applies:
 *   - "<YYYY>/<work>/<file>"   → Shape 1 (year folder → work groups)
 *   - "<YYYY>/<file>"          → Shape 1 loose image
 *   - "<folder>/<file>..."     → Shape 2 (top-level non-year folder)
 *   - "<file>"                 → Shape 3 (top-level loose image)
 */
async function scanContentFromBlobs(): Promise<ScannedFolder[]> {
  const store = contentStorage();
  const keys = await store.listKeys();

  // Skip dotfiles and Invoices subtrees, mirroring the FS scanner.
  const okKeys: string[] = [];
  for (const k of keys) {
    const parts = k.split("/");
    if (parts.some((p) => p === "" || p.startsWith("."))) continue;
    if (parts.some((p) => p.toLowerCase() === "invoices")) continue;
    okKeys.push(k);
  }

  // Group by the top-level segment.
  const byTop = new Map<string, string[]>();
  const looseTopFiles: string[] = [];
  for (const k of okKeys) {
    const slash = k.indexOf("/");
    if (slash < 0) {
      looseTopFiles.push(k);
    } else {
      const top = k.slice(0, slash);
      if (!byTop.has(top)) byTop.set(top, []);
      byTop.get(top)!.push(k);
    }
  }

  const folders: ScannedFolder[] = [];
  const yearFolderRe = /^(\d{4})(?:\s+and\s+(?:earlier|later))?$/i;

  // Shape 3: loose top-level images each become their own Work group.
  for (const k of looseTopFiles) {
    if (!isPublishable(path.basename(k))) continue;
    const stat = await store.stat(k);
    if (!stat) continue;
    const stem = path.parse(k).name;
    const guess = guessFromFolderName(stem);
    folders.push({
      name: k,
      relPath: k,
      guessedSlug: guess.slug,
      guessedTitle: guess.title,
      guessedYear: guess.year,
      guessedMonth: guess.month,
      guessedDay: guess.day,
      guessedSequence: guess.sequence,
      guessedSection: guess.section,
      isLooseFile: true,
      files: [{ name: k, relPath: k, isImage: true, size: stat.size }],
    });
  }

  for (const [top, subkeys] of byTop) {
    const yearMatch = top.match(yearFolderRe);
    if (yearMatch) {
      // Year folder. Group its children by their next segment.
      const yearNumber = parseInt(yearMatch[1], 10);
      const yearSection = yearToSection(Number.isFinite(yearNumber) ? yearNumber : null);
      const childGroups = new Map<string, string[]>(); // subfolder name → keys under it
      const looseChildren: string[] = []; // direct loose children
      for (const k of subkeys) {
        const rest = k.slice(top.length + 1);
        const next = rest.indexOf("/");
        if (next < 0) {
          looseChildren.push(k);
        } else {
          const childName = rest.slice(0, next);
          if (!childGroups.has(childName)) childGroups.set(childName, []);
          childGroups.get(childName)!.push(k);
        }
      }

      // Each subfolder under the year → its own Work group, *iff* it
      // contains at least one publishable image. Empty Work groups are
      // skipped.
      for (const [childName, childKeys] of childGroups) {
        const files: ScannedFile[] = [];
        const relPath = `${top}/${childName}`;
        for (const k of childKeys) {
          const baseName = path.basename(k);
          if (baseName.startsWith(".")) continue;
          if (!isPublishable(baseName)) continue;
          const stat = await store.stat(k);
          files.push({
            name: baseName,
            relPath: k,
            isImage: true,
            size: stat?.size ?? 0,
          });
        }
        if (files.length === 0) continue;
        const guess = guessFromFolderName(childName);
        const inheritedYear = guess.year ?? yearNumber;
        folders.push({
          name: childName,
          relPath,
          guessedSlug: guess.slug || slugify(childName),
          guessedTitle: guess.title || childName,
          guessedYear: Number.isFinite(inheritedYear) ? inheritedYear : null,
          guessedMonth: guess.month,
          guessedDay: guess.day,
          guessedSequence: guess.sequence,
          guessedSection: guess.section ?? yearSection,
          isLooseFile: false,
          files,
        });
      }

      // Loose images in the year folder → each its own one-image Work.
      for (const k of looseChildren) {
        if (!isPublishable(path.basename(k))) continue;
        const stat = await store.stat(k);
        if (!stat) continue;
        const stem = path.parse(path.basename(k)).name;
        const guess = guessFromFolderName(stem);
        const inheritedYear = guess.year ?? yearNumber;
        folders.push({
          name: path.basename(k),
          relPath: k,
          guessedSlug: guess.slug || slugify(stem),
          guessedTitle: guess.title || stem,
          guessedYear: Number.isFinite(inheritedYear) ? inheritedYear : null,
          guessedMonth: guess.month,
          guessedDay: guess.day,
          guessedSequence: guess.sequence,
          guessedSection: guess.section ?? yearSection,
          isLooseFile: true,
          files: [{ name: path.basename(k), relPath: k, isImage: true, size: stat.size }],
        });
      }
      continue;
    }

    // Shape 2: top-level non-year folder → one Work group containing
    // everything underneath (recursive). Skip if no publishable images.
    const files: ScannedFile[] = [];
    for (const k of subkeys) {
      const baseName = path.basename(k);
      if (baseName.startsWith(".")) continue;
      if (!isPublishable(baseName)) continue;
      const stat = await store.stat(k);
      files.push({
        name: baseName,
        relPath: k,
        isImage: true,
        size: stat?.size ?? 0,
      });
    }
    if (files.length === 0) continue;
    const guess = guessFromFolderName(top);
    folders.push({
      name: top,
      relPath: top,
      guessedSlug: guess.slug || slugify(top),
      guessedTitle: guess.title || top,
      guessedYear: guess.year,
      guessedMonth: guess.month,
      guessedDay: guess.day,
      guessedSequence: guess.sequence,
      guessedSection: guess.section,
      isLooseFile: false,
      files,
    });
  }

  folders.sort((a, b) => {
    const ay = a.guessedYear ?? 0;
    const by = b.guessedYear ?? 0;
    if (ay !== by) return by - ay;
    const aSeq = a.guessedSequence ?? 0;
    const bSeq = b.guessedSequence ?? 0;
    if (aSeq !== bSeq) return bSeq - aSeq;
    return a.name.localeCompare(b.name);
  });

  return folders;
}
