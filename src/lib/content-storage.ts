import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getStore, type Store } from "@netlify/blobs";

/**
 * Storage abstraction for the artwork content layer.
 *
 *   Production (Netlify):   uses Netlify Blobs ("content" store)
 *   Local dev (Devin's PC): uses the on-disk CONTENT_ROOT folder
 *
 * The interface is intentionally minimal — list / has / get / put / stat
 * — and modeled after a flat key-value store. Keys are forward-slash paths
 * like "2025/2025.31_The Portal/IMG_0293.PNG", relative to the storage
 * root. The keys preserve subfolder structure so the existing scanner
 * can still group files into Work groups by their path prefix.
 *
 * `listKeys()` returns the full set of stored keys. `get()` returns the
 * raw bytes. `stat()` returns size + lastModified for fast manifest
 * comparisons during sync.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

export interface StorageStat {
  size: number;
  /** Milliseconds since epoch. Optional — Blobs gives us its own. */
  lastModified?: number;
}

export interface ContentStorage {
  /** List every key currently in storage, in any order. */
  listKeys(): Promise<string[]>;
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array | Buffer | ArrayBuffer | string, metadata?: Record<string, string>): Promise<void>;
  stat(key: string): Promise<StorageStat | null>;
}

// ---------- Netlify Blobs implementation ----------

class BlobsStorage implements ContentStorage {
  private store: Store;
  constructor() {
    // "content" is the store name; site-scoped so it survives deploys.
    this.store = getStore("content");
  }
  async listKeys(): Promise<string[]> {
    const keys: string[] = [];
    // Netlify Blobs list() returns a paginated iterable.
    const { blobs } = await this.store.list();
    for (const b of blobs) keys.push(b.key);
    return keys;
  }
  async has(key: string): Promise<boolean> {
    const meta = await this.store.getMetadata(key);
    return meta !== null;
  }
  async get(key: string): Promise<Uint8Array | null> {
    const buf = await this.store.get(key, { type: "arrayBuffer" });
    if (buf === null) return null;
    return new Uint8Array(buf);
  }
  async put(
    key: string,
    data: Uint8Array | Buffer | ArrayBuffer | string,
    metadata?: Record<string, string>
  ): Promise<void> {
    await this.store.set(key, data as any, metadata ? { metadata } : undefined);
  }
  async stat(key: string): Promise<StorageStat | null> {
    const m = await this.store.getMetadata(key);
    if (!m) return null;
    const size =
      typeof m.metadata?.size === "string"
        ? parseInt(m.metadata.size, 10)
        : 0;
    const lastModified =
      typeof m.metadata?.lastModified === "string"
        ? parseInt(m.metadata.lastModified, 10)
        : undefined;
    return { size: Number.isFinite(size) ? size : 0, lastModified };
  }
}

// ---------- Filesystem fallback (local dev) ----------

class FilesystemStorage implements ContentStorage {
  constructor(private rootAbs: string) {}

  private absFor(key: string): string {
    const norm = key.replace(/\\/g, "/").replace(/^\/+/, "");
    const abs = path.resolve(this.rootAbs, norm);
    // Guard against path traversal.
    if (!abs.startsWith(this.rootAbs + path.sep) && abs !== this.rootAbs) {
      throw new Error(`Path escapes storage root: ${key}`);
    }
    return abs;
  }

  async listKeys(): Promise<string[]> {
    const out: string[] = [];
    await this.walkInto(this.rootAbs, "", out);
    return out;
  }
  private async walkInto(absDir: string, relPrefix: string, out: string[]) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childAbs = path.join(absDir, e.name);
      const childRel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await this.walkInto(childAbs, childRel, out);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  async has(key: string): Promise<boolean> {
    try {
      const stat = await fs.stat(this.absFor(key));
      return stat.isFile();
    } catch {
      return false;
    }
  }
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await fs.readFile(this.absFor(key));
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
  async put(
    key: string,
    data: Uint8Array | Buffer | ArrayBuffer | string,
    _metadata?: Record<string, string>
  ): Promise<void> {
    const abs = this.absFor(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    if (typeof data === "string") {
      await fs.writeFile(abs, data, "utf-8");
    } else if (data instanceof ArrayBuffer) {
      await fs.writeFile(abs, Buffer.from(data));
    } else if (data instanceof Uint8Array) {
      await fs.writeFile(abs, data);
    } else {
      await fs.writeFile(abs, data as Buffer);
    }
  }
  async stat(key: string): Promise<StorageStat | null> {
    try {
      const s = await fs.stat(this.absFor(key));
      if (!s.isFile()) return null;
      return { size: s.size, lastModified: s.mtimeMs };
    } catch {
      return null;
    }
  }
}

// ---------- Selection ----------

/**
 * Returns the storage implementation appropriate for the current
 * environment. On Netlify (process.env.NETLIFY === "true") we use Blobs;
 * otherwise we fall back to a filesystem store rooted at CONTENT_ROOT
 * (the same folder the existing scanner reads). This keeps Devin's local
 * Drive-for-Desktop workflow working unchanged.
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

let _instance: ContentStorage | null = null;

export function contentStorage(): ContentStorage {
  if (_instance) return _instance;
  const onNetlify =
    typeof process !== "undefined" && process.env?.NETLIFY === "true";
  if (onNetlify) {
    _instance = new BlobsStorage();
  } else {
    _instance = new FilesystemStorage(readContentRoot());
  }
  return _instance;
}

/** True iff the current environment uses Netlify Blobs (production). */
export function usingBlobs(): boolean {
  return typeof process !== "undefined" && process.env?.NETLIFY === "true";
}
