import crypto from "node:crypto";

export const SESSION_COOKIE = "khanart_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * Read configured secrets. We check `process.env` first (the source of
 * truth in production on Netlify and in Node SSR generally) and fall
 * back to `import.meta.env` for Astro's dev server, which loads
 * `.env.local` through Vite but doesn't always mirror onto `process.env`.
 *
 * We use static property names — not a dynamic `envValue(name)` helper —
 * so Vite can correctly resolve `import.meta.env.*` at both dev time and
 * build time.
 */
export function getAdminPassword(): string | undefined {
  const fromProcess =
    typeof process !== "undefined" ? process.env?.ADMIN_PASSWORD : undefined;
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  // @ts-expect-error import.meta.env shape is provided by Vite at runtime
  const fromMeta = import.meta.env?.ADMIN_PASSWORD as string | undefined;
  return fromMeta && fromMeta.length > 0 ? fromMeta : undefined;
}

export function getSessionSecret(): string | undefined {
  const fromProcess =
    typeof process !== "undefined" ? process.env?.SESSION_SECRET : undefined;
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  // @ts-expect-error import.meta.env shape is provided by Vite at runtime
  const fromMeta = import.meta.env?.SESSION_SECRET as string | undefined;
  return fromMeta && fromMeta.length > 0 ? fromMeta : undefined;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf-8") : buf;
  return b
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function hmac(secret: string, data: string): string {
  return base64urlEncode(
    crypto.createHmac("sha256", secret).update(data).digest()
  );
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

interface SessionPayload {
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expires-at, seconds since epoch. */
  exp: number;
}

/**
 * Verify a plaintext password against the configured ADMIN_PASSWORD.
 * Constant-time. Returns false if either side is missing.
 */
export function verifyPassword(input: string): boolean {
  const expected = getAdminPassword();
  if (!expected || !input) return false;
  return timingSafeEqual(input, expected);
}

/**
 * Issue a signed session cookie value. Pair it with the cookie attributes
 * returned by `sessionCookieAttributes()`.
 */
export function issueSession(): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const body = base64urlEncode(JSON.stringify(payload));
  const sig = hmac(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verify a session cookie value. Returns true iff the signature checks
 * against SESSION_SECRET and the payload has not expired.
 */
export function verifySession(value: string | undefined | null): boolean {
  if (!value) return false;
  const secret = getSessionSecret();
  if (!secret) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  const expectedSig = hmac(secret, body);
  if (!timingSafeEqual(sig, expectedSig)) return false;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf-8"));
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return false;
  return true;
}

export interface CookieAttrs {
  name: string;
  value: string;
  maxAge: number;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax" | "strict" | "none";
}

export function sessionSetAttributes(value: string): CookieAttrs {
  return {
    name: SESSION_COOKIE,
    value,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    httpOnly: true,
    secure: true, // Astro's cookies API will drop this in non-https dev anyway
    sameSite: "lax",
  };
}

export function sessionClearAttributes(): CookieAttrs {
  return {
    name: SESSION_COOKIE,
    value: "",
    maxAge: 0,
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  };
}

/**
 * True iff the server is fully configured for auth. If false, all admin
 * routes should reject everything (fail closed).
 */
export function authConfigured(): boolean {
  return !!getAdminPassword() && !!getSessionSecret();
}
