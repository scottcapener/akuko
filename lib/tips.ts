// ── Tips content ──────────────────────────────────────────────────────────────
// The "Tip of the day" copy is authored in a Google Sheet Scott controls and
// published to the web as CSV (File → Share → Publish to web → CSV). The sheet
// is a single column, one tip per row, ordered basic → advanced — that row order
// is the display order. Editing the sheet updates the app within a day (see the
// daily revalidate on `fetchTips` / `/api/tips`), no deploy required.
//
// `FALLBACK_TIPS` mirrors the sheet at time of writing and is served whenever the
// fetch or parse fails, so the card never renders empty.

export const TIPS_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXsNMNKaBH3Bg_RpN3tKhKNzz3alhsy6CY4f7UwT9B6uT_hWc1qGL1fGnP2XhiobFMvcFxzJuIKSqH/pub?output=csv";

// Re-fetch the sheet at most once a day — matches the "tip of the day" cadence.
export const TIPS_REVALIDATE_SECONDS = 60 * 60 * 24;

export const FALLBACK_TIPS: string[] = [
  "Scenes can be used to outline your chapters, but do whatever feels most natural to you.",
  "Everything you write saves automatically, so no need to hit a save button.",
  "Not everyone likes it dark: you can switch to light mode in Settings.",
  "Add all of your reference material right beside your writing. Each chapter gets its own library.",
  "Music links can be individual songs, albums, playlists, even YouTube videos.",
  "Add a book cover whenever you feel ready. Ask around for artist recommendations!",
  "You can also add reference material for your whole book on the Book Info page.",
  "Turn on automatic daily backups to keep your writing safe.",
  "Drag scenes to change their order, even from one chapter to another.",
  "Use Export to save and download a copy of your book. You can also export specific chapters.",
  "On the Book Info page, you can choose which sections count towards your total word count.",
  "Did you know you can use Hot Cocoa even when you're offline?",
  "Right click a chapter to open it side-by-side with the current one.",
];

// Parse a published-sheet CSV into an ordered list of tips. The sheet is a single
// column, but this tolerates extra columns (only the first cell of each row is
// used) and RFC-4180 quoting: cells containing commas are wrapped in quotes, and
// a literal quote inside is doubled (""). Blank rows are skipped.
export function parseTipsCsv(csv: string): string[] {
  const text = csv.replace(/\r\n?/g, "\n");
  const tips: string[] = [];
  let i = 0;

  while (i < text.length) {
    let cell = "";

    if (text[i] === '"') {
      // Quoted cell — consume until the closing quote, unescaping "" → ".
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          i++;
          break;
        }
        cell += text[i++];
      }
    } else {
      // Bare cell — up to the next comma or newline.
      while (i < text.length && text[i] !== "," && text[i] !== "\n") cell += text[i++];
    }

    // Ignore any remaining columns, then advance past the row's newline.
    while (i < text.length && text[i] !== "\n") i++;
    if (i < text.length) i++;

    const trimmed = cell.trim();
    if (trimmed) tips.push(trimmed);
  }

  return tips;
}

// Server-side: the published sheet, cached for a day, with the committed list as
// a fallback. Used by the /api/tips route (for the writer's card) and the
// How to Use Hot Cocoa page. Never throws — a bad fetch degrades to FALLBACK_TIPS.
export async function fetchTips(): Promise<string[]> {
  try {
    const res = await fetch(TIPS_CSV_URL, {
      next: { revalidate: TIPS_REVALIDATE_SECONDS },
    });
    if (!res.ok) return FALLBACK_TIPS;
    const parsed = parseTipsCsv(await res.text());
    return parsed.length ? parsed : FALLBACK_TIPS;
  } catch {
    return FALLBACK_TIPS;
  }
}
