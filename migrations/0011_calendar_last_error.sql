-- Surface a dead Google Calendar connection instead of swallowing it.
--
-- A refresh token can expire or be revoked (an OAuth consent screen left in
-- "Testing" expires them after 7 days). When that happens every push and every
-- cron pull throws, the error is only console.error'd, and the user silently
-- stops getting calendar sync with no signal anywhere in the app.
--
-- Record the last refresh failure on the account so /api/calendar/status can ask
-- for a reconnect, and clear it on the next successful refresh.
ALTER TABLE calendar_accounts ADD COLUMN last_error TEXT;
ALTER TABLE calendar_accounts ADD COLUMN last_error_at TEXT;
