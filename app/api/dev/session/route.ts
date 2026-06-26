import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Dev-only endpoint: signs in with server-side credentials and returns session tokens.
// The client calls setSession() so the browser Supabase client gets a real auth session,
// which satisfies RLS policies without exposing credentials to client-side JS.
export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  const email = process.env.DEV_USER_EMAIL;
  const password = process.env.DEV_USER_PASSWORD;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Set DEV_USER_EMAIL and DEV_USER_PASSWORD in .env.local" },
      { status: 500 }
    );
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: error.message }, { status: 401 });

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
