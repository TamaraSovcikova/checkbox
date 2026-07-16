-- Per-area look: its own colour scheme and a banner image.
--
-- `palette` = a key from lib/theme.ts PALETTES, applied to the area page only
--             (see the descendant [data-palette] selectors in index.css).
--             NULL means "use whatever the app is set to", which is what every
--             area did before, so NULL is the right default.
-- `banner`  = an image URL. Either a link straight to the web, or /api/areas/<id>/banner
--             for one uploaded to R2. Stored as a URL either way so rendering
--             does not care which it is.
ALTER TABLE areas ADD COLUMN palette TEXT;
ALTER TABLE areas ADD COLUMN banner TEXT;
