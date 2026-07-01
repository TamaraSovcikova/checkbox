-- Add UNIQUE constraint on push_subscriptions.endpoint for upsert support.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_endpoint ON push_subscriptions(endpoint);
