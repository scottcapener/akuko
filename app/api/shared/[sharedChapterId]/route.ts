import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { getSharedChapterView } from "@/lib/shared/read";

export const runtime = "nodejs";

// GET /api/shared/[sharedChapterId] — one shared chapter with book context, for
// the read view (§3.3). Returns 404 when RLS hides the snapshot (the caller is
// neither owner nor an accepted recipient). Opening it marks the chapter read.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/shared/[sharedChapterId]">
) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sharedChapterId } = await ctx.params;
  const view = await getSharedChapterView(supabase, user.id, sharedChapterId);
  if (!view) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(view);
}
