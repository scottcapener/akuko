import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShareState, ShareRecipient } from "./types";

// The current sharing state of one live chapter, for the mini-menu + Share
// modal (SHARED_WITH_YOU.md §3.5/§3.6). Runs under the author's session; RLS
// confines it to snapshots they own. Signed avatar URLs match how covers/
// avatars render elsewhere (24h TTL, re-minted on <img> error by Avatar).

const AVATAR_TTL = 60 * 60 * 24;

export async function getShareState(
  supabase: SupabaseClient,
  chapterId: string
): Promise<ShareState> {
  const { data: snapshot } = await supabase
    .from("shared_chapters")
    .select("id, updated_at")
    .eq("chapter_id", chapterId)
    .maybeSingle();

  if (!snapshot) {
    return { chapterId, sharedChapterId: null, shared: false, recipients: [], stale: false };
  }

  // Freshness: the live chapter has edits since the snapshot was last taken.
  // chapters.updated_at is maintained by migration 019 (direct edits + a scene
  // trigger), so this is one cheap read, not a scan of scene bodies.
  const { data: chapter } = await supabase
    .from("chapters")
    .select("updated_at")
    .eq("id", chapterId)
    .maybeSingle();
  const stale =
    !!chapter?.updated_at &&
    !!snapshot.updated_at &&
    new Date(chapter.updated_at).getTime() > new Date(snapshot.updated_at).getTime();

  const { data: grants } = await supabase
    .from("chapter_shares")
    .select("recipient_email, recipient_id")
    .eq("shared_chapter_id", snapshot.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  const rows = grants ?? [];

  // Resolve names + avatars for grants that map to an account.
  const ids = rows.map((r) => r.recipient_id).filter((id): id is string => !!id);
  const profileById = new Map<string, { display_name: string | null; avatar_path: string | null }>();
  if (ids.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .in("id", ids);
    (profiles ?? []).forEach((p) =>
      profileById.set(p.id, { display_name: p.display_name, avatar_path: p.avatar_path })
    );
  }

  const recipients: ShareRecipient[] = [];
  for (const row of rows) {
    const email = String(row.recipient_email);
    const profile = row.recipient_id ? profileById.get(row.recipient_id) : undefined;
    let avatarUrl: string | null = null;
    if (profile?.avatar_path) {
      const { data } = await supabase.storage
        .from("library-files")
        .createSignedUrl(profile.avatar_path, AVATAR_TTL);
      avatarUrl = data?.signedUrl ?? null;
    }
    recipients.push({
      email,
      name: profile?.display_name || email,
      avatarUrl,
      pending: !row.recipient_id,
    });
  }

  return { chapterId, sharedChapterId: snapshot.id, shared: true, recipients, stale };
}
