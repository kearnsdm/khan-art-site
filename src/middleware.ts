import { defineMiddleware } from "astro:middleware";
import {
  SESSION_COOKIE,
  authConfigured,
  verifySession,
} from "./lib/auth";

/**
 * Gate `/admin/*` and the admin-only API routes behind a signed-session
 * cookie. If the cookie is missing or invalid the user is redirected to
 * `/login`. If the server is not configured for auth (no env vars), all
 * gated routes return 503 — fail closed so a misconfigured deploy can't
 * accidentally expose the admin.
 *
 * NOTE: /api/image is INTENTIONALLY NOT gated. After the runtime-Blobs
 * refactor, every <img> on the public site uses /api/image to fetch
 * bytes from Blobs storage — gating it would 401 every visitor. The
 * endpoint only serves bytes by storage key, which the public pages
 * already know (they generate the URLs themselves), so there's no
 * privacy concern from leaving it open. /api/thumb stays gated — it's
 * an admin-only thumbnail generator with extra processing cost.
 */
const GATED_PREFIXES = [
  "/admin",
  "/api/save",
  "/api/save-tags",
  "/api/save-year-groups",
  "/api/sync",
  "/api/content.json",
  "/api/thumb",
];

function isGated(pathname: string): boolean {
  return GATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname === p + ".json");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = new URL(context.request.url);
  if (!isGated(url.pathname)) {
    return next();
  }

  if (!authConfigured()) {
    return new Response(
      "Admin is not configured on this deploy. ADMIN_PASSWORD and SESSION_SECRET must be set.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const cookie = context.cookies.get(SESSION_COOKIE)?.value;
  if (verifySession(cookie)) {
    return next();
  }

  // For API routes, return a JSON 401 so the client can handle it. For
  // page routes, redirect to /login carrying the original destination so
  // we can bounce back after a successful sign-in.
  const wantsJson =
    url.pathname.startsWith("/api/") ||
    context.request.headers.get("accept")?.includes("application/json");
  if (wantsJson) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const next_ = encodeURIComponent(url.pathname + url.search);
  return context.redirect(`/login?next=${next_}`);
});
