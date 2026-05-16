import type { APIRoute } from "astro";
import { sessionClearAttributes } from "../../lib/auth";

export const prerender = false;

const handler: APIRoute = async ({ cookies, redirect }) => {
  const attrs = sessionClearAttributes();
  cookies.set(attrs.name, attrs.value, {
    maxAge: attrs.maxAge,
    path: attrs.path,
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
  });
  return redirect("/");
};

export const POST = handler;
export const GET = handler;
