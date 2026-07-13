-- Let the user organise their Today page: a pin can sit in the full-width strip
-- at the TOP, in a narrow SIDE column, or be unpinned. Plus a colour so pins
-- aren't all the same.
ALTER TABLE pins ADD COLUMN placement TEXT NOT NULL DEFAULT 'unpinned'; -- 'unpinned' | 'top' | 'side'
ALTER TABLE pins ADD COLUMN color TEXT;                                  -- colour token (see lib/colors)

-- Carry the old boolean forward: anything pinned to Today becomes a top pin.
UPDATE pins SET placement = 'top' WHERE pinned_today = 1;
