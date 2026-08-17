import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { sanitizeProseHtml } from "@/lib/sanitize";

// Node runtime: sanitize-html needs Node APIs.
export const runtime = "nodejs";

// The single write path for profile fields the Account page edits. Runs under
// the caller's session (the "own profile" RLS policy from 001 confines the
// update to their own row), and adds what the client can't be trusted with:
// a required non-empty display name and server-side sanitization of the bio
// HTML before it's ever stored.
export async function PATCH(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: {
    displayName?: unknown;
    penName?: unknown;
    bio?: unknown;
    avatarPath?: unknown;
    notifyOnShare?: unknown;
    notifyOnComment?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Build the patch from only the fields that were supplied, so a bio-only
  // autosave doesn't clobber the name and vice versa.
  const patch: Record<string, string | boolean | null> = {};

  if (body.displayName !== undefined) {
    const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }
    patch.display_name = name;
  }

  if (body.penName !== undefined) {
    const pen = typeof body.penName === "string" ? body.penName.trim() : "";
    patch.pen_name = pen || null;
  }

  if (body.bio !== undefined) {
    const bio = typeof body.bio === "string" ? sanitizeProseHtml(body.bio) : "";
    patch.bio = bio || null;
  }

  if (body.avatarPath !== undefined) {
    // A storage path under the caller's own folder, or null to clear it.
    const raw = body.avatarPath;
    if (raw === null) {
      patch.avatar_path = null;
    } else if (typeof raw === "string" && raw.startsWith(`${user.id}/`)) {
      patch.avatar_path = raw;
    } else {
      return NextResponse.json({ error: "Invalid avatar path." }, { status: 400 });
    }
  }

  if (body.notifyOnShare !== undefined) {
    patch.notify_on_share = body.notifyOnShare === true;
  }

  if (body.notifyOnComment !== undefined) {
    patch.notify_on_comment = body.notifyOnComment === true;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, profile: patch });
}
