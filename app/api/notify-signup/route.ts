import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { sendSignupEmail } from "@/lib/email/signupEmail";

// Fires the internal "new signup" notification once a user finishes the signup
// wizard (app/signup/page.tsx handleStep3, after the profile is written).
//
// Runs under the caller's own session and reads the caller's own email + name,
// so it can't be driven to email about anyone else. Best-effort by design: the
// account already exists by the time this is called, so a failed send must
// never surface as a failed signup — the client fires it and ignores the result.

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const name = (profile?.display_name as string | null)?.trim() || "New user";
  const email = user.email ?? "";

  const { sent } = await sendSignupEmail({ name, email });
  return NextResponse.json({ ok: true, sent });
}
