-- Related tasks: a SYMMETRIC, non-blocking link between two tasks that have
-- something to do with each other ("book the flights" and "renew the passport").
--
-- Deliberately NOT task_dependencies. A dependency is directional and changes
-- behaviour: it blocks the waiting task, drives the Flow runway, and gates the
-- ready line. A link changes nothing about order or readiness; it exists so that
-- opening one task shows you the others you will want in the same sitting.
--
-- Stored as TWO rows per link (a->b and b->a), written and deleted in one batch.
-- Symmetry in the data rather than in every query: hydration then reads one
-- direction, and no caller has to remember to check both.
CREATE TABLE IF NOT EXISTS task_links (
  task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  linked_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, linked_id)
);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_linked ON task_links(linked_id);
