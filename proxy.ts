import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated users can't access the editor or account page
  if (!user && (pathname.startsWith("/write") || pathname.startsWith("/account"))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Authenticated users trying to reach /login go to /write
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/write", request.url));
  }

  // Authenticated users on /signup — only redirect away if their profile is
  // already complete (display_name set). If they're mid-signup (no profile yet)
  // let them stay on /signup to finish.
  if (user && pathname === "/signup") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();

    const profileComplete = !!profile?.display_name;
    if (profileComplete) {
      return NextResponse.redirect(new URL("/write", request.url));
    }
    // Profile incomplete — fall through and let them finish signup
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
