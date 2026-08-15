// ── What's New ────────────────────────────────────────────────────────────────
// The source of truth for release announcements, rendered two ways from the same
// data: the one-time modal on the writer (components/WhatsNewModal) and the feed
// on the Updates workspace page. Add a new entry to the TOP of `updates` when a
// feature ships — that flips the modal on for every user who hasn't dismissed it
// (their profile.updates_seen_id no longer matches the latest id; migration 016).
//
// Content is authored here, in the repo, so it ships in the same PR as the
// feature it announces, and the small bits of inline emphasis (`html` /`items`)
// are trusted — never user input — which is why the renderer is allowed to inject
// them as HTML.

// A block of an update's body. Kept structured (rather than one HTML blob) so the
// modal and the feed lay the pieces out identically.
export type UpdateBlock =
  | { kind: "lead"; text: string } //      italic intro line
  | { kind: "paragraph"; html: string } // may contain <strong>
  | { kind: "bullets"; items: string[] }; // each item may contain <strong>

export interface Update {
  /** Stable slug — the value stored in profile.updates_seen_id. Never reuse or
   *  rename one; changing it re-shows the modal to everyone. */
  id: string;
  /** ISO date (YYYY-MM-DD). Rendered as "Freshly stirred Month DD, YYYY". */
  date: string;
  title: string;
  /** Featured image path under /public. Omit (or let it fail to load) to fall
   *  back to the proportional accent block. Displayed at its natural ratio. */
  image?: string;
  imageAlt?: string;
  body: UpdateBlock[];
}

// Newest first. `updates[0]` is what the modal announces.
export const updates: Update[] = [
  {
    id: "share-and-comment",
    date: "2026-08-14",
    title: "Share chapters & add comments",
    image: "/updates/share-and-comment.png",
    imageAlt: "Sharing a chapter and leaving a comment in Hot Cocoa",
    body: [
      { kind: "lead", text: "Hot Cocoa has a new feature 🎉🎉🎉" },
      {
        kind: "paragraph",
        html: "You can now <strong>share your chapters</strong> with others, and <strong>add comments</strong> to chapters that have been shared with you!",
      },
      {
        kind: "bullets",
        items: [
          "Use the <strong>Chapter Menu</strong> to share chapters (bottom-right corner)",
          "The new <strong>Shared</strong> page shows all chapters you've been invited to",
          "While reading a chapter, <strong>highlight text</strong> to add a comment",
        ],
      },
    ],
  },
];

export const latestUpdate: Update | undefined = updates[0];

const UPDATE_IDS = new Set(updates.map((u) => u.id));

/** Whether `id` names a real update — guards the seen-cursor write route. */
export function isUpdateId(id: string): boolean {
  return UPDATE_IDS.has(id);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "Freshly stirred August 14, 2026" — the fixed date treatment for updates.
 *  Parses the ISO date-only string directly to stay free of timezone drift. */
export function freshlyStirred(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const month = MONTHS[(m ?? 1) - 1] ?? "";
  return `Freshly stirred ${month} ${d}, ${y}`;
}
