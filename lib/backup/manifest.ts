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

export const SCHEMA_VERSION = 1;

export const MANIFEST_FILENAME = "manifest.json";
export const IMAGES_DIR = "images";

export interface BackupBook {
  title: string;
  coverColor: string;
  coverImagePath?: string; // directly-usable URL/data-URL, copied as-is on restore
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
  type: "image" | "text" | "music";
  position: number;
  // image
  imageFile?: string;    // path inside the ZIP, e.g. "images/<id>"; blob bundled
  contentType?: string;  // captured from the stored blob, used to re-upload
  filename?: string;
  // image (external URL only, no bundled blob) / music
  url?: string;
  // text (notes) + music (og metadata)
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
