import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only same-origin paths: a bare `${origin}${next}` with a crafted `next`
  // (e.g. "@evil.com", or "//" / "/\" which browsers read as scheme-relative)
  // becomes an open redirect on the URL emails land on.
  const rawNext = searchParams.get("next") ?? "/";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/";

  if (code || tokenHash) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    // Prefer the token-hash (OTP) flow: the token is self-contained in the URL,
    // so it verifies even when the email is opened in a different browser or
    // storage context than the one that requested it — e.g. an iOS home-screen
    // PWA requests the reset, but the email link opens in Safari. The PKCE
    // `code` flow can't do this: it needs the code verifier stored by the
    // originating context, which the opening browser doesn't have.
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type ?? "recovery" })
      : await supabase.auth.exchangeCodeForSession(code!);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
}
