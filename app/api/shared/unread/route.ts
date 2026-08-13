import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getUnreadState } from "@/lib/shared/unread";

export const runtime = "nodejs";

// Unread state across every shared chapter the caller can access (§6). Feeds the
// account-menu "Shared" count, the panel dots, and the editor Comments-tab count.
// A static segment, so it wins over /api/shared/[sharedChapterId].
//
//   GET → { total, chapters: [{ chapterId, sharedChapterId, unreadComments, unread }] }

export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const state = await getUnreadState(supabase, user.id);
  return NextResponse.json(state);
}
