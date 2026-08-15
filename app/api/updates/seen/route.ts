import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { isUpdateId } from "@/lib/updates";

export const runtime = "nodejs";

// Advance the caller's What's New cursor — the writer's modal POSTs the id of the
// update it just dismissed, which stops it reappearing (here and on the user's
// other devices) until a newer update ships. Runs under the caller's session; the
// "own profile" RLS policy (001) confines the write to their own row.
//
//   POST { id }  → { ok: true }

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  // Only known ids are accepted, so a stale or forged value can't park the cursor
  // on something that never re-syncs.
  if (!isUpdateId(id)) {
    return NextResponse.json({ error: "Unknown update id." }, { status: 400 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ updates_seen_id: id })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
