import { createAdminClient } from "@/lib/supabase/admin";

// Sign Storage paths for shared content (covers, author avatars). These live in
// the OWNER's folder, which a recipient can't sign under the bucket's
// owner-scoped RLS — so signing goes through the service-role client
// server-side (SHARED_WITH_YOU.md §Identity). Access to the underlying rows is
// already gated by RLS before we ever sign, so this only mints URLs for content
// the caller can legitimately see. Null on any failure → the UI falls back to a
// placeholder / initials. Server-only.

const TTL = 60 * 60 * 24; // 24h, matching covers/avatars elsewhere

export async function signSharedPath(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const { data } = await admin.storage.from("library-files").createSignedUrl(path, TTL);
  return data?.signedUrl ?? null;
}

/** Batch variant — one admin client, signed in parallel. */
export async function signSharedPaths(
  paths: (string | null | undefined)[]
): Promise<(string | null)[]> {
  const admin = createAdminClient();
  if (!admin) return paths.map(() => null);
  return Promise.all(
    paths.map(async (p) => {
      if (!p) return null;
      const { data } = await admin.storage.from("library-files").createSignedUrl(p, TTL);
      return data?.signedUrl ?? null;
    })
  );
}
