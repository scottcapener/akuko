export interface Scene {
  id: string;
  label: string;
  body: string;
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

export interface ChapterLibrary {
  images: LibraryImage[];
  notes: LibraryNote[];
  musicLinks: LibraryMusicLink[];
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
  coverImage?: string;
  activeChapterId: string;
}
