-- Starred projects: a hand-picked shortlist of what matters right now.
--
-- 20+ active projects means the ones being pushed daily (Revisia, App Trading)
-- drown among the practice lists and someday-projects. A star is a manual
-- "this is current" flag: starred projects surface in their own sidebar
-- section for one-click access, and the planned dashboard's starred widget
-- reads the same flag. Deliberately manual, not derived from activity;
-- what counts as current is a judgment, not a metric.

ALTER TABLE projects ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
