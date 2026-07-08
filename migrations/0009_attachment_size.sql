-- Track each stored file's byte size so the app can enforce a total-storage cap
-- and stay under R2's 10 GB free tier (never bill). Link attachments stay 0.
ALTER TABLE attachments ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
