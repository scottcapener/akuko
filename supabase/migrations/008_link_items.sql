-- Research links live in the same library_items table as images, notes, and
-- music links, distinguished by a new `link` type. Widen the type CHECK
-- constraint to admit it. Link metadata reuses the generic OG columns:
--   url             → original URL
--   og_title        → page title
--   og_description  → site name (og:site_name)
--   og_image        → favicon URL
alter table library_items drop constraint if exists library_items_type_check;
alter table library_items add constraint library_items_type_check
  check (type in ('image', 'text', 'music', 'link'));
