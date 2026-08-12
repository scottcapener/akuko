import type { SupabaseClient } from "@supabase/supabase-js";
import { signSharedPath, signSharedPaths } from "./covers";

// Comments data layer (SHARED_WITH_YOU.md §3.4/§3.7). Runs under the caller's
// session; RLS gates every read/write to chapters they can access. Author
// identity uses display_name + avatar (§Identity); avatars live in the author's
// own Storage folder, so they're signed via the service-role client (covers.ts).

export interface CommentDTO {
  id: string;
  sharedSceneId: string;
  /** The live scene id (via shared_scenes.scene_id) — editor tier-1 grouping. */
  sceneId: string | null;
  scenePosition: number;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  quoteText: string;
  quoteStart: number;
  quoteEnd: number;
  /** The share generation (shared_chapters.updated_at) the quote was made against. */
  snapshotVersion: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedById: string | null;
}

export interface CommentsResponse {
  /** Chapter owner — lets the client decide who may resolve. */
  ownerId: string;
  comments: CommentDTO[];
}

interface CommentRow {
  id: string;
  shared_scene_id: string;
  author_id: string;
  body: string;
  quote_text: string;
  quote_start: number;
  quote_end: number;
  snapshot_version: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

const COLS =
  "id, shared_scene_id, author_id, body, quote_text, quote_start, quote_end, snapshot_version, created_at, updated_at, resolved_at, resolved_by";

/** All comments on a shared chapter, oldest first. Null when RLS hides the
 *  chapter (no access). */
export async function getComments(
  supabase: SupabaseClient,
  sharedChapterId: string
): Promise<CommentsResponse | null> {
  const { data: chapter } = await supabase
    .from("shared_chapters")
    .select("owner_id")
    .eq("id", sharedChapterId)
    .maybeSingle();
  if (!chapter) return null;

  const { data: rows } = await supabase
    .from("comments")
    .select(COLS)
    .eq("shared_chapter_id", sharedChapterId)
    .order("created_at", { ascending: true });

  const comments = (rows ?? []) as CommentRow[];

  // Scene identity/order for grouping + sorting.
  const sceneIds = [...new Set(comments.map((c) => c.shared_scene_id))];
  const sceneMeta = new Map<string, { sceneId: string | null; position: number }>();
  if (sceneIds.length) {
    const { data: scenes } = await supabase
      .from("shared_scenes")
      .select("id, scene_id, position")
      .in("id", sceneIds);
    (scenes ?? []).forEach((s) =>
      sceneMeta.set(s.id, { sceneId: s.scene_id, position: s.position ?? 0 })
    );
  }

  // Author display names + avatars.
  const authorIds = [...new Set(comments.map((c) => c.author_id))];
  const profileById = new Map<string, { display_name: string | null; avatar_path: string | null }>();
  if (authorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_path")
      .in("id", authorIds);
    (profiles ?? []).forEach((p) =>
      profileById.set(p.id, { display_name: p.display_name, avatar_path: p.avatar_path })
    );
  }
  const avatarUrls = await signSharedPaths(
    comments.map((c) => profileById.get(c.author_id)?.avatar_path ?? null)
  );

  const dtos: CommentDTO[] = comments.map((c, i) => {
    const meta = sceneMeta.get(c.shared_scene_id);
    return {
      id: c.id,
      sharedSceneId: c.shared_scene_id,
      sceneId: meta?.sceneId ?? null,
      scenePosition: meta?.position ?? 0,
      authorId: c.author_id,
      authorName: profileById.get(c.author_id)?.display_name || "Someone",
      authorAvatarUrl: avatarUrls[i],
      body: c.body,
      quoteText: c.quote_text,
      quoteStart: c.quote_start,
      quoteEnd: c.quote_end,
      snapshotVersion: c.snapshot_version,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      resolvedAt: c.resolved_at,
      resolvedById: c.resolved_by,
    };
  });

  return { ownerId: chapter.owner_id as string, comments: dtos };
}

export interface CreateCommentInput {
  sharedChapterId: string;
  sharedSceneId: string;
  body: string;
  quoteText: string;
  quoteStart: number;
  quoteEnd: number;
}

/** Insert a comment as the caller and return it enriched. RLS enforces access
 *  and self-authorship; this stamps the current snapshot generation. */
export async function createComment(
  supabase: SupabaseClient,
  userId: string,
  input: CreateCommentInput
): Promise<CommentDTO> {
  const { data: chapter } = await supabase
    .from("shared_chapters")
    .select("updated_at")
    .eq("id", input.sharedChapterId)
    .maybeSingle();

  const { data: inserted, error } = await supabase
    .from("comments")
    .insert({
      shared_chapter_id: input.sharedChapterId,
      shared_scene_id: input.sharedSceneId,
      author_id: userId,
      body: input.body,
      quote_text: input.quoteText,
      quote_start: input.quoteStart,
      quote_end: input.quoteEnd,
      snapshot_version: chapter?.updated_at ?? new Date().toISOString(),
    })
    .select(COLS)
    .single();
  if (error || !inserted) throw error ?? new Error("Failed to create comment");
  const row = inserted as CommentRow;

  // Enrich: the author is the caller; fetch their profile + the scene meta.
  const [{ data: profile }, { data: scene }] = await Promise.all([
    supabase.from("profiles").select("display_name, avatar_path").eq("id", userId).maybeSingle(),
    supabase.from("shared_scenes").select("scene_id, position").eq("id", input.sharedSceneId).maybeSingle(),
  ]);
  const authorAvatarUrl = await signSharedPath(profile?.avatar_path ?? null);

  return {
    id: row.id,
    sharedSceneId: row.shared_scene_id,
    sceneId: (scene?.scene_id as string | null) ?? null,
    scenePosition: (scene?.position as number | null) ?? 0,
    authorId: userId,
    authorName: (profile?.display_name as string | null) || "Someone",
    authorAvatarUrl,
    body: row.body,
    quoteText: row.quote_text,
    quoteStart: row.quote_start,
    quoteEnd: row.quote_end,
    snapshotVersion: row.snapshot_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedById: row.resolved_by,
  };
}
