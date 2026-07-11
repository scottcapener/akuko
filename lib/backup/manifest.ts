/**
 * Backup package format — shared by server-side generation and
 * client-side restore. A backup is a ZIP:
 *
 *   {timestamp}.zip
 *   ├── manifest.json   — everything below
 *   └── images/         — one file per bundled library image, named by
 *                         its manifest id (see BackupLibraryItem.imageFile)
 *
 * SCHEMA_VERSION is stamped into every manifest so a future Book/
 * Chapter/Scene shape change can detect and either migrate or clearly
 * reject an older backup during restore, instead of failing silently.
 */

// v2: covers moved from inline data URLs (stored in the book row) to Storage,
// so a stored cover is bundled as a blob in the ZIP (coverImageFile) instead of
// being a self-contained data URL. v1 backups (data-URL covers) still restore.
export const SCHEMA_VERSION = 2;

export const MANIFEST_FILENAME = "manifest.json";
export const IMAGES_DIR = "images";
// ZIP entry for a bundled book cover (v2+).
export const COVER_ENTRY = "cover/data";

export interface BackupBook {
  title: string;
  coverColor: string;
  // Legacy (v1) inline cover: a directly-usable data/http URL, copied as-is.
  coverImagePath?: string;
  // v2 stored cover: ZIP path to the bundled blob (see COVER_ENTRY) + its
  // content type, re-uploaded to the restored book's own cover on restore.
  coverImageFile?: string;
  coverContentType?: string;
  wordCount: number;
  unlocks: number[];
}

export interface BackupSection {
  id: string;
  label: string;
  position: number;
}

export interface BackupChapter {
  id: string;
  sectionId: string;
  title: string;
  position: number;
}

export interface BackupScene {
  id: string;
  chapterId: string;
  label: string;
  body: string;
  position: number;
}

export interface BackupLibraryItem {
  id: string;
  chapterId: string;
  type: "image" | "text" | "music" | "link";
  position: number;
  // image
  imageFile?: string;    // path inside the ZIP, e.g. "images/<id>"; blob bundled
  contentType?: string;  // captured from the stored blob, used to re-upload
  filename?: string;
  // image (external URL only, no bundled blob) / music / link
  url?: string;
  // text (notes) + music + link (og metadata; link uses ogDescription for the
  // site name and ogImage for the favicon)
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
}

export interface BackupManifest {
  schemaVersion: number;
  createdAt: string;
  book: BackupBook;
  sections: BackupSection[];
  chapters: BackupChapter[];
  scenes: BackupScene[];
  libraryItems: BackupLibraryItem[];
}
