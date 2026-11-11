-- ============================================================
-- 022: Library image dimensions
--
-- Stores each library image's natural pixel size so the gallery can lay out
-- its masonry grid (and the loading skeletons) at the right proportions on
-- first paint, before any thumbnail has loaded. Nullable: existing images are
-- backfilled by the client the first time each one loads (lib/db.ts
-- setLibraryImageDimensions), and the app works without these columns.
-- ============================================================

alter table public.library_items
  add column if not exists width  integer,
  add column if not exists height integer;
