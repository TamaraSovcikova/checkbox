-- Unique constraint enabling upsert in calendar_events_cache.
-- Required for: INSERT ... ON CONFLICT(gcal_event_id, calendar_id) DO UPDATE
CREATE UNIQUE INDEX IF NOT EXISTS idx_evcache_unique_event
  ON calendar_events_cache(gcal_event_id, calendar_id);
