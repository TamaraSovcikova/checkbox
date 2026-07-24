-- Two-way Obsidian vault sync (v1). A task born from a vault note carries its
-- source; sync happens when a Claude session (the only thing that can reach
-- the local filesystem) runs the pull/writeback MCP tools.
--   source_path: vault-relative note path
--   source_line: 1-indexed line at last sync (drifts; matching prefers text)
--   source_text: the exact line at last sync. THE match key, and the change
--                detector: incoming text != stored text means the vault edited
--                the line since last sync.
--   vault_dirty: Checkbox changed done-state or due date since last sync;
--                the writeback tools drain this flag.

ALTER TABLE tasks ADD COLUMN source_path TEXT;
ALTER TABLE tasks ADD COLUMN source_line INTEGER;
ALTER TABLE tasks ADD COLUMN source_text TEXT;
ALTER TABLE tasks ADD COLUMN vault_dirty INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_tasks_source ON tasks(user_id, source_path);
