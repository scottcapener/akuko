// Curated Book Info tag taxonomy, modeled on the genre/shelf systems readers see
// at Barnes & Noble and on Goodreads, plus a handful of current online-fiction
// trends (e.g. "Anime-inspired", "Romantasy", "Progression Fantasy").
//
// Each tag has a stable `id` (persisted on books.tags — never rename an id, only
// its label) and a human `label`. `category` groups tags in source for
// maintenance and lets the picker cluster them; the Book Tags modal renders a
// flat, selected-first grid regardless.

export interface BookTag {
  id: string;
  label: string;
  category: BookTagCategory;
}

export type BookTagCategory = "Genre" | "Audience" | "Themes & Tropes" | "Trending";

// Labels are Sentence case per Hot Cocoa's brand voice (see DESIGN_SYSTEM.md
// "Brand voice"). Proper nouns, initialisms, and stylized brand/genre terms
// (LGBTQ+, LitRPG, GameLit, BookTok) keep their canonical casing.
export const BOOK_TAGS: BookTag[] = [
  // ── Genre ──────────────────────────────────────────────────────────────
  { id: "fantasy", label: "Fantasy", category: "Genre" },
  { id: "epic-fantasy", label: "Epic fantasy", category: "Genre" },
  { id: "dark-fantasy", label: "Dark fantasy", category: "Genre" },
  { id: "urban-fantasy", label: "Urban fantasy", category: "Genre" },
  { id: "science-fiction", label: "Science fiction", category: "Genre" },
  { id: "space-opera", label: "Space opera", category: "Genre" },
  { id: "cyberpunk", label: "Cyberpunk", category: "Genre" },
  { id: "dystopian", label: "Dystopian", category: "Genre" },
  { id: "post-apocalyptic", label: "Post-apocalyptic", category: "Genre" },
  { id: "romance", label: "Romance", category: "Genre" },
  { id: "contemporary-romance", label: "Contemporary romance", category: "Genre" },
  { id: "historical-romance", label: "Historical romance", category: "Genre" },
  { id: "paranormal-romance", label: "Paranormal romance", category: "Genre" },
  { id: "romantasy", label: "Romantasy", category: "Genre" },
  { id: "mystery", label: "Mystery", category: "Genre" },
  { id: "cozy-mystery", label: "Cozy mystery", category: "Genre" },
  { id: "thriller", label: "Thriller", category: "Genre" },
  { id: "psychological-thriller", label: "Psychological thriller", category: "Genre" },
  { id: "suspense", label: "Suspense", category: "Genre" },
  { id: "crime", label: "Crime", category: "Genre" },
  { id: "horror", label: "Horror", category: "Genre" },
  { id: "historical-fiction", label: "Historical fiction", category: "Genre" },
  { id: "literary-fiction", label: "Literary fiction", category: "Genre" },
  { id: "contemporary-fiction", label: "Contemporary fiction", category: "Genre" },
  { id: "womens-fiction", label: "Women's fiction", category: "Genre" },
  { id: "adventure", label: "Adventure", category: "Genre" },
  { id: "action", label: "Action", category: "Genre" },
  { id: "magical-realism", label: "Magical realism", category: "Genre" },
  { id: "mythology", label: "Mythology & folklore", category: "Genre" },
  { id: "fairy-tale-retelling", label: "Fairy-tale retelling", category: "Genre" },
  { id: "western", label: "Western", category: "Genre" },
  { id: "humor", label: "Humor", category: "Genre" },
  { id: "satire", label: "Satire", category: "Genre" },
  { id: "poetry", label: "Poetry", category: "Genre" },
  { id: "short-stories", label: "Short stories", category: "Genre" },
  { id: "memoir", label: "Memoir", category: "Genre" },
  { id: "biography", label: "Biography", category: "Genre" },
  { id: "nonfiction", label: "Nonfiction", category: "Genre" },

  // ── Audience ───────────────────────────────────────────────────────────
  { id: "childrens", label: "Children's", category: "Audience" },
  { id: "middle-grade", label: "Middle grade", category: "Audience" },
  { id: "young-adult", label: "Young adult", category: "Audience" },
  { id: "new-adult", label: "New adult", category: "Audience" },
  { id: "adult", label: "Adult", category: "Audience" },
  { id: "lgbtq", label: "LGBTQ+", category: "Audience" },

  // ── Themes & Tropes ────────────────────────────────────────────────────
  { id: "coming-of-age", label: "Coming of age", category: "Themes & Tropes" },
  { id: "found-family", label: "Found family", category: "Themes & Tropes" },
  { id: "enemies-to-lovers", label: "Enemies to lovers", category: "Themes & Tropes" },
  { id: "slow-burn", label: "Slow burn", category: "Themes & Tropes" },
  { id: "friends-to-lovers", label: "Friends to lovers", category: "Themes & Tropes" },
  { id: "second-chance", label: "Second-chance romance", category: "Themes & Tropes" },
  { id: "forbidden-love", label: "Forbidden love", category: "Themes & Tropes" },
  { id: "love-triangle", label: "Love triangle", category: "Themes & Tropes" },
  { id: "chosen-one", label: "Chosen one", category: "Themes & Tropes" },
  { id: "anti-hero", label: "Anti-hero", category: "Themes & Tropes" },
  { id: "morally-gray", label: "Morally gray", category: "Themes & Tropes" },
  { id: "redemption-arc", label: "Redemption arc", category: "Themes & Tropes" },
  { id: "revenge", label: "Revenge", category: "Themes & Tropes" },
  { id: "quest", label: "Quest", category: "Themes & Tropes" },
  { id: "sword-and-sorcery", label: "Sword & sorcery", category: "Themes & Tropes" },
  { id: "portal-fantasy", label: "Portal fantasy", category: "Themes & Tropes" },

  // ── Trending ───────────────────────────────────────────────────────────
  { id: "anime-inspired", label: "Anime-inspired", category: "Trending" },
  { id: "manga-inspired", label: "Manga-inspired", category: "Trending" },
  { id: "isekai", label: "Isekai", category: "Trending" },
  { id: "litrpg", label: "LitRPG", category: "Trending" },
  { id: "gamelit", label: "GameLit", category: "Trending" },
  { id: "progression-fantasy", label: "Progression fantasy", category: "Trending" },
  { id: "cultivation", label: "Cultivation / xianxia", category: "Trending" },
  { id: "cozy-fantasy", label: "Cozy fantasy", category: "Trending" },
  { id: "grimdark", label: "Grimdark", category: "Trending" },
  { id: "dark-academia", label: "Dark academia", category: "Trending" },
  { id: "cottagecore", label: "Cottagecore", category: "Trending" },
  { id: "steampunk", label: "Steampunk", category: "Trending" },
  { id: "hopepunk", label: "Hopepunk", category: "Trending" },
  { id: "solarpunk", label: "Solarpunk", category: "Trending" },
  { id: "booktok", label: "BookTok", category: "Trending" },
];

const BOOK_TAGS_BY_ID = new Map(BOOK_TAGS.map((t) => [t.id, t]));

/** Resolve a tag id to its full record (undefined for an unknown/removed id). */
export function getBookTag(id: string): BookTag | undefined {
  return BOOK_TAGS_BY_ID.get(id);
}

/** Human label for a tag id, falling back to the id itself for legacy/unknown
 *  ids so a removed tag never renders blank. */
export function bookTagLabel(id: string): string {
  return BOOK_TAGS_BY_ID.get(id)?.label ?? id;
}
