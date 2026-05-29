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

export interface LibraryFile {
  id: string;
  name: string;
  content: string;
}

export interface LibraryMusicLink {
  id: string;
  url: string;
  title: string;
}

export interface ChapterLibrary {
  images: LibraryImage[];
  files: LibraryFile[];
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
  chapters: Chapter[];
  activeChapterId: string;
}
