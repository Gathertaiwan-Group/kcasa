-- Responsive WebP variants (480/960/1440, q75) stored at site-kcasa/v/<width>/<storage path>.webp
-- [{ "w": 480, "h": 320, "path": "v/480/uploads/2025/06/x.webp", "bytes": 12345 }, ...] (only widths below `width`)
alter table site_kcasa.media add column if not exists variants jsonb not null default '[]'::jsonb;
