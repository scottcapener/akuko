import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { sendFeedbackEmail } from "@/lib/email/feedbackEmail";

// Delivers the writer's Give Feedback form to the internal inbox — see
// components/FeedbackModal.tsx.
//
// Runs under the caller's own session and reads the caller's own email + name,
// so the client only supplies the message (never the identity it's sent under);
// it can't be driven to send feedback as someone else. The message is capped
// server-side to keep a runaway paste out of the email.

export const runtime = "nodejs";

const MAX_MESSAGE = 5000;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) {
    return NextResponse.json({ error: "Feedback message is required." }, { status: 400 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, pen_name")
    .eq("id", user.id)
    .maybeSingle();

  const name =
    (profile?.pen_name as string | null)?.trim() ||
    (profile?.display_name as string | null)?.trim() ||
    "Anonymous";
  const email = user.email ?? "";

  const { sent } = await sendFeedbackEmail({ name, email, message });
  return NextResponse.json({ ok: true, sent });
}
