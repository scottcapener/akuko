import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Daily platform snapshot for the PostHog "Marketing overview" dashboard. Hit
 * once a day by Vercel Cron; guarded by CRON_SECRET.
 *
 * Counts the true all-time totals straight from the database (users, books,
 * chapters, words, writing time, tags, shares, comments, library items) and sends them to
 * PostHog as one `platform_snapshot` event, plus one `platform_snapshot_tag`
 * event per Book Info tag in use. Client events only exist from the day they
 * shipped; this snapshot covers everything since day one.
 *
 * Aggregates only — no ids, titles, prose, or anything about a single person.
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!admin || !posthogKey || !posthogHost) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  try {
    const [
      users,
      chapters,
      sharedEver,
      sharedNow,
      comments,
      images,
      musicLinks,
      notes,
      links,
      books,
      days,
    ] = await Promise.all([
      countAuthUsers(admin),
      countRows(admin, "chapters"),
      countRows(admin, "shared_chapters"),
      countRows(admin, "shared_chapters", { currentOnly: true }),
      countRows(admin, "comments"),
      // Chapter library items, by type ("text" is a note).
      countRows(admin, "library_items", { type: "image" }),
      countRows(admin, "library_items", { type: "music" }),
      countRows(admin, "library_items", { type: "text" }),
      countRows(admin, "library_items", { type: "link" }),
      allRows<{ word_count: number | null; tags: string[] | null; info_chapter_id: string | null }>(
        admin,
        "books",
        "word_count, tags, info_chapter_id"
      ),
      allRows<{ active_seconds: number | null }>(admin, "writing_days", "active_seconds"),
    ]);

    const tagCounts = new Map<string, number>();
    for (const b of books) {
      for (const tag of b.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const totals = {
      users,
      books: books.length,
      // Each book's hidden Book Info chapter isn't a chapter the author sees.
      chapters: chapters - books.filter((b) => b.info_chapter_id).length,
      words: books.reduce((t, b) => t + (b.word_count ?? 0), 0),
      hours: Math.round(days.reduce((t, d) => t + (d.active_seconds ?? 0), 0) / 36) / 100,
      writing_days: days.length,
      tags_used: [...tagCounts.values()].reduce((t, n) => t + n, 0),
      books_with_tags: books.filter((b) => (b.tags ?? []).length > 0).length,
      shared_chapters: sharedEver,
      shared_chapters_current: sharedNow,
      comments,
      images,
      music_links: musicLinks,
      notes,
      links,
    };

    const timestamp = new Date().toISOString();
    const base = {
      distinct_id: "hot-cocoa-server",
      timestamp,
    };
    const common = {
      environment: process.env.NODE_ENV,
      // Server-side aggregate: never create or update a person profile.
      $process_person_profile: false,
    };
    const batch = [
      { ...base, event: "platform_snapshot", properties: { ...common, ...totals } },
      ...[...tagCounts].map(([tag_id, books]) => ({
        ...base,
        event: "platform_snapshot_tag",
        properties: { ...common, tag_id, books },
      })),
    ];

    const res = await fetch(`${posthogHost.replace(/\/$/, "")}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: posthogKey, batch }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `PostHog ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true, totals, tags: tagCounts.size });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

async function countRows(
  admin: SupabaseClient,
  table: string,
  opts?: {
    currentOnly?: boolean; // shared_chapters still shared (not unshared)
    type?: string; // library_items type
  }
): Promise<number> {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (opts?.currentOnly) q = q.is("unshared_at", null);
  if (opts?.type) q = q.eq("type", opts.type);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

// Accounts, not profiles: a few accounts never got a profile row.
async function countAuthUsers(admin: SupabaseClient): Promise<number> {
  const PER_PAGE = 1000;
  let total = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`users: ${error.message}`);
    total += data.users.length;
    if (data.users.length < PER_PAGE) return total;
  }
}

// PostgREST caps a response at 1000 rows, so page through.
async function allRows<T>(admin: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const PAGE = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET.
export async function GET(request: Request) {
  return handle(request);
}
