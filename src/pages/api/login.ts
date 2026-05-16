import type { APIRoute } from "astro";
import {
  authConfigured,
  issueSession,
  sessionSetAttributes,
  verifyPassword,
} from "../../lib/auth";

export const prerender = false;

const SAFE_NEXT_RE = /^\/(?!\/)[^\s]*$/;

function pickNext(input: string | null | undefined): string {
  if (!input) return "/admin/works";
  // Only allow same-origin paths (must start with "/" and not "//").
  if (!SAFE_NEXT_RE.test(input)) return "/admin/works";
  if (input.startsWith("/login")) return "/admin/works";
  return input;
}

export const POST: APIRoute = async ({ request, cookies, redirect, url }) => {
  if (!authConfigured()) {
    return new Response(
      "Admin is not configured on this deploy.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  let password = "";
  let next = url.searchParams.get("next");

  if (contentType.includes("application/json")) {
    try {
      const body = (await request.json()) as { password?: string; next?: string };
      password = body?.password ?? "";
      if (body?.next) next = body.next;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
  } else {
    // application/x-www-form-urlencoded — the plain HTML form path.
    const form = await request.formData();
    password = String(form.get("password") ?? "");
    const formNext = form.get("next");
    if (typeof formNext === "string") next = formNext;
  }

  if (!verifyPassword(password)) {
    // Bounce back to /login with an error indicator. We use a query param
    // so the static-rendered login page can show a message without us
    // needing JS or server-side flash storage.
    const params = new URLSearchParams({ error: "1" });
    if (next) params.set("next", next);
    return redirect(`/login?${params.toString()}`);
  }

  const session = issueSession();
  if (!session) {
    return new Response(
      "Admin is not configured on this deploy.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const attrs = sessionSetAttributes(session);
  cookies.set(attrs.name, attrs.value, {
    maxAge: attrs.maxAge,
    path: attrs.path,
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
  });

  return redirect(pickNext(next));
};
