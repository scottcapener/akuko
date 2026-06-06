import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight Edge middleware for route gating.
 *
 * This intentionally does NOT import the Supabase client. It only checks for
 * the presence of the Supabase auth cookie to decide redirects. This keeps the
 * Edge bundle free of Node-only code (avoids the `__dirname is not defined`
 * crash) and routable on Vercel.
 *
 * Real security is enforced by Row Level Security + server-side `getUser()`
 * calls — not here. Middleware redirects are purely a UX convenience.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase stores the session in cookies named `sb-<ref>-auth-token`
  // (possibly chunked as `.0`, `.1`). Presence = likely logged in.
  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  // Unauthenticated users can't access the editor or account page
  if (!hasSession && (pathname.startsWith("/write") || pathname.startsWith("/account"))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated users trying to reach /login go straight to the editor
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/write", request.url));
  }

  // Note: /signup is handled by the page itself — it detects an existing
  // session on mount, resumes at the right step, and redirects to /write
  // if the profile is already complete.

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
