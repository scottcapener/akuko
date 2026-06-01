export interface Scene {
  id: string;
  label: string;
  body: string;
}

export interface LibraryImage {
  id: string;
  name: string;
  dataUrl: string;
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
  scenes: Scene[];
  library: ChapterLibrary;
}

export interface Book {
  id: string;
  title: string;
  coverColor: string;
  coverImage?: string; // data URL
  chapters: Chapter[];
  activeChapterId: string;
}
