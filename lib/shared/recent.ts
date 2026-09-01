import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecentPartner } from "./types";
import { signSharedPaths } from "./covers";

// "Recent share partners" for the Share modal (SHARED_WITH_YOU.md §3.5): the
// distinct people the author has shared any of their chapters with, newest
// first, so re-sharing is one tap. Runs under the author's session — RLS keeps
// it to grants on snapshots they own (owner_id filter is belt-and-suspenders).
// Avatars live in each partner's own Storage folder, so they're signed through
// the service-role client (covers.ts), same as everywhere partner identity is
// rendered. The modal filters out anyone already on the current chapter.

const MAX_PARTNERS = 12;

export async function getRecentPartners(
  supabase: SupabaseClient,
  userId: string
): Promise<RecentPartner[]> {
  // The author's own snapshots.
  const { data: snaps } = await supabase
    .from("shared_chapters")
    .select("id")
    .eq("owner_id", userId);
  const snapshotIds = (snaps ?? []).map((s) => s.id as string);
  if (!snapshotIds.length) return [];

  // Every live grant across them, newest first.
  const { data: grants } = await supabase
    .from("chapter_shares")
    .select("recipient_email, recipient_id, created_at")
    .in("shared_chapter_id", snapshotIds)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  // Distinct by email — the desc order means the first sighting is the most
  // recent share to that person.
  const seen = new Set<string>();
  const distinct: { email: string; recipientId: string | null }[] = [];
  for (const g of grants ?? []) {
    const email = String(g.recipient_email).toLowerCase();
    // Never suggest the author themselves — self-sharing is allowed (a writing-
    // group host may want their own chapters in /shared), but the quick-list is
    // for inviting other people. A resolved self-grant has recipient_id == me.
    if (g.recipient_id === userId) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    distinct.push({ email, recipientId: (g.recipient_id as string | null) ?? null });
    if (distinct.length >= MAX_PARTNERS) break;
  }
  if (!distinct.length) return [];

  // Resolve names + avatars for partners who have an account.
  const accountIds = distinct.map((d) => d.recipientId).filter((id): id is string => !!id);
  const profileById = new Map<string, { display_name: string | null; avatar_path: string | null }>();
  if (accountIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .in("id", accountIds);
    (profiles ?? []).forEach((p) =>
      profileById.set(p.id, { display_name: p.display_name, avatar_path: p.avatar_path })
    );
  }

  const avatarUrls = await signSharedPaths(
    distinct.map((d) => (d.recipientId ? profileById.get(d.recipientId)?.avatar_path : null))
  );

  return distinct.map((d, i) => {
    const profile = d.recipientId ? profileById.get(d.recipientId) : undefined;
    return {
      email: d.email,
      name: profile?.display_name || d.email,
      avatarUrl: avatarUrls[i],
    };
  });
}
