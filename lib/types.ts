export interface Scene {
  id: string;
  label: string;
  body: string;
  // Server `updated_at` as of load or last successful save. Still tracked for the
  // shared-chapter "View as reader" freshness check; no longer a concurrency base
  // (see contentEditedAt).
  updatedAt: string;
  // Last-write-wins token (migration 021): when the text was last actually edited,
  // on whichever device. A save wins only if its authoredAt is newer than the
  // row's content_edited_at, so the latest edit wins with no cached base to go
  // stale — this is what retired the false-conflict modal. Set on load and when a
  // newer server version is adopted; the value SENT on a save is the client's
  // edit-time clock, not this field. Optional: absent for synthetic scenes and
  // pre-021 rows. See CONFLICT_SUNSET.md.
  contentEditedAt?: string;
}

export interface LibraryImage {
  id: string;
  name: string;
  dataUrl: string;
  // Storage path for files in the library-files bucket. Present for uploaded
  // images (whose dataUrl is a time-limited signed URL); used to re-mint the
  // URL when it expires. Absent for images stored as an external URL.
  path?: string;
}

export interface LibraryNote {
  id: string;
  title: string;
  body: string; // HTML — plain text + <em> tags only
  position: number;
}

export interface LibraryMusicLink {
  id: string;
  url: string;
  title: string;
  description: string;
  image: string;     // og:image URL (may be empty)
  loading?: boolean;
}

// A research link. Rendered as a Link List Item: favicon + page title + site
// name. Reuses the OG scrape for metadata (title / og:site_name / favicon).
export interface LibraryLink {
  id: string;
  url: string;
  title: string;     // og:title (falls back to hostname)
  siteName: string;  // og:site_name (falls back to hostname)
  favicon: string;   // absolute favicon URL (may be empty)
}

export interface ChapterLibrary {
  images: LibraryImage[];
  notes: LibraryNote[];
  musicLinks: LibraryMusicLink[];
  links: LibraryLink[];
}

export interface Chapter {
  id: string;
  title: string;
  sectionId: string;
  scenes: Scene[];
  library: ChapterLibrary;
}

export interface Section {
  id: string;
  label: string;
  position: number;
  chapters: Chapter[];
}

export interface Book {
  id: string;
  title: string;
  coverColor: string;
  // Display URL for the cover: a signed URL for a stored cover, or a legacy
  // inline data URL. Time-limited when signed, so it's re-minted on <img> error.
  coverImage?: string;
  // Storage path in the library-files bucket for an uploaded cover; used to
  // re-mint the signed URL when it expires. Absent for legacy data-URL covers.
  coverImagePath?: string;
  activeChapterId: string;
  // Selected Book Info tags (tag ids from lib/bookTags). Empty by default.
  tags: string[];
  // The hidden "info chapter" backing Book Info: its single scene is the
  // Synopsis, its library_items are the Book-Info Library. Never appears in
  // `sections`. Absent only for a book whose info chapter hasn't been
  // provisioned yet (getOrCreateBook creates it lazily).
  infoChapterId?: string;
  // Section ids the author has excluded from the "official" manuscript word
  // count via the Book Stats ••• menu. Unchecked sections still count toward
  // whole-book achievements — this only narrows the Book Info total.
  excludedSectionIds: string[];
}
