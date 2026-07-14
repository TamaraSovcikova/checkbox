-- Multi-calendar pull: sync events from ALL of the user's Google calendars
-- (routines, work, family, imported feeds), not just primary, so the grid shows
-- everything as a backdrop to schedule tasks around.
--
-- Sync tokens are per-calendar in the Google API, so store them as a JSON map
-- { calendarId: syncToken } instead of the single legacy `sync_token` column.
-- Each cached event gets the source calendar's colour so the grid can tint by
-- calendar (matching how Google shows them).

ALTER TABLE calendar_accounts ADD COLUMN sync_tokens TEXT;
ALTER TABLE calendar_events_cache ADD COLUMN color TEXT;
