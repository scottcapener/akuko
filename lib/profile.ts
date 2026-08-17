"use client";

// Profile reads + avatar-file storage for the Account page. Text writes
// (display_name / pen_name / bio / avatar_path) go through PATCH
// /api/account/profile instead, so the server validates and sanitizes — this
// module only handles the two things the browser must do itself: read the row
// and push the avatar bytes into Storage.

import { createClient } from "./supabase/client";

// Mirrors lib/db.ts — avatars live in the shared `library-files` bucket, whose
// owner-scoped RLS keys off the first path segment ({user_id}/…). Signed URLs
// expire; a 24h TTL keeps churn low and the <img> re-mints on error.
const SIGNED_URL_TTL = 60 * 60 * 24;

export interface Profile {
  displayName: string;
  penName: string;
  bio: string;
  avatarPath: string | null;
  avatarUrl: string | null; // signed, ready for <img src>
  notifyOnShare: boolean; // receive the "shared a chapter with you" email (§6)
  notifyOnComment: boolean; // receive the "commented on your chapter" email (§5)
}

function supabase() {
  return createClient();
}

async function signAvatar(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase()
    .storage.from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

/** Re-mint a signed avatar URL (for <img onError>). */
export async function signAvatarUrl(path: string): Promise<string> {
  return (await signAvatar(path)) ?? "";
}

/** Read the current user's profile row and sign the avatar for display. */
export async function getProfile(userId: string): Promise<Profile> {
  let { data, error } = await supabase()
    .from("profiles")
    .select("display_name, pen_name, bio, avatar_path")
    .eq("id", userId)
    .single();

  // Tolerate the window where the code has shipped but migration 011 (bio /
  // avatar_path) hasn't run yet: fall back to the columns guaranteed to exist
  // so the page still shows the name instead of hard-failing.
  if (error) {
    const legacy = await supabase()
      .from("profiles")
      .select("display_name, pen_name")
      .eq("id", userId)
      .single();
    data = legacy.data as typeof data;
  }

  // Notification prefs (notify_on_share migration 015, notify_on_comment 017) are
  // read on their own so a not-yet-run migration can't take bio/avatar down with
  // it. Missing column → default to opted-in.
  const { data: pref } = await supabase()
    .from("profiles")
    .select("notify_on_share, notify_on_comment")
    .eq("id", userId)
    .single();

  const avatarPath = (data?.avatar_path as string | null) ?? null;
  return {
    displayName: data?.display_name ?? "",
    penName: data?.pen_name ?? "",
    bio: data?.bio ?? "",
    avatarPath,
    avatarUrl: await signAvatar(avatarPath),
    notifyOnShare: (pref?.notify_on_share as boolean | null | undefined) ?? true,
    notifyOnComment: (pref?.notify_on_comment as boolean | null | undefined) ?? true,
  };
}

/** Upload a new avatar to the owner's folder; returns its path + a signed URL.
 *  The path is persisted separately via the profile PATCH route. */
export async function uploadAvatar(
  userId: string,
  file: File
): Promise<{ path: string; signedUrl: string }> {
  const path = `${userId}/avatar/${Date.now()}-${file.name}`;
  const db = supabase();

  const { error } = await db.storage.from("library-files").upload(path, file);
  if (error) throw error;

  const { data: signed } = await db.storage
    .from("library-files")
    .createSignedUrl(path, SIGNED_URL_TTL);
  return { path, signedUrl: signed?.signedUrl ?? "" };
}

/** Remove a stored avatar object (fire-and-forget when replacing/clearing). */
export async function removeAvatarFile(path: string): Promise<void> {
  await supabase().storage.from("library-files").remove([path]);
}
