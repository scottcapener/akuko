import type { SupabaseClient } from "@supabase/supabase-js";
import { snapshotChapter } from "./snapshot";

// Server-only orchestration for "share this chapter" (SHARED_WITH_YOU.md §3.5).
// First share snapshots the chapter and creates the grants; adding a recipient
// to an already-shared chapter is a grant only (no re-snapshot — they see the
// current copy). Runs under the AUTHOR's session; RLS confines every write.
//
// Stage 1 creates every grant as PENDING (recipient_id null). Resolving an
// email to an existing account, redemption at signup/login, and the share
// email all land in Stage 2 — this leaves the seams for them.

// A pragmatic address check — real validation is the email actually arriving.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmails(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const e = (r ?? "").trim().toLowerCase();
    if (e && EMAIL_RE.test(e) && !seen.has(e)) {
      seen.add(e);
      out.push(e);
    }
  }
  return out;
}

export interface ShareResult {
  sharedChapterId: string;
  created: boolean;
  /** Emails that gained an active grant on this call (new or un-revoked). */
  addedEmails: string[];
}

/**
 * Share `chapterId` with `emails`. Snapshots on first share, then ensures an
 * active grant per email. Idempotent: re-adding an existing recipient is a
 * no-op; re-adding a revoked one re-activates their grant.
 */
export async function shareChapter(
  supabase: SupabaseClient,
  ownerId: string,
  chapterId: string,
  emails: string[]
): Promise<ShareResult> {
  const clean = normalizeEmails(emails);

  const { sharedChapterId, created } = await snapshotChapter(supabase, chapterId, ownerId);

  const addedEmails = await grantRecipients(supabase, ownerId, sharedChapterId, clean);
  return { sharedChapterId, created, addedEmails };
}

/**
 * Ensure an active grant on `sharedChapterId` for each email. Returns the
 * emails that were newly granted or re-activated (what Stage 2 will email).
 */
export async function grantRecipients(
  supabase: SupabaseClient,
  ownerId: string,
  sharedChapterId: string,
  emails: string[]
): Promise<string[]> {
  if (emails.length === 0) return [];

  // Which of these already have a grant (so we don't re-notify the unchanged)?
  const { data: existing } = await supabase
    .from("chapter_shares")
    .select("recipient_email, revoked_at")
    .eq("shared_chapter_id", sharedChapterId)
    .in("recipient_email", emails);

  const existingByEmail = new Map<string, { revoked_at: string | null }>();
  (existing ?? []).forEach((r) =>
    existingByEmail.set(String(r.recipient_email).toLowerCase(), { revoked_at: r.revoked_at })
  );

  const added: string[] = [];
  const toInsert: Record<string, unknown>[] = [];

  for (const email of emails) {
    const prior = existingByEmail.get(email);
    if (!prior) {
      toInsert.push({
        shared_chapter_id: sharedChapterId,
        recipient_email: email,
        recipient_id: null, // PENDING — resolved at signup/login (Stage 2)
        shared_by: ownerId,
      });
      added.push(email);
    } else if (prior.revoked_at) {
      // Re-activate a previously revoked grant in place.
      await supabase
        .from("chapter_shares")
        .update({ revoked_at: null, created_at: new Date().toISOString() })
        .eq("shared_chapter_id", sharedChapterId)
        .eq("recipient_email", email);
      added.push(email);
    }
    // else: an active grant already exists — nothing to do.
  }

  if (toInsert.length) {
    const { error } = await supabase.from("chapter_shares").insert(toInsert);
    if (error) throw error;
  }

  return added;
}
