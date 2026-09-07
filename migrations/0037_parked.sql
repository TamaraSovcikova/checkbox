-- Parking a task: deliberately set aside, with no date, until something changes.
--
-- She was already doing this by hand, once, with a title prefix and the optional
-- flag: "PARKED: writer website and portfolio (reopens only if the author path
-- is ruled an income path)". It sat in a normal working list with PARKED
-- shouting at the top of it, which is the problem rather than the solution.
--
-- Why none of the five existing "not now" states covers it, measured against how
-- they are actually used:
--   snooze         4 tasks, none further out than 9 days. A short deferral that
--                  BRINGS THE TASK BACK on its own. Parking has no date, and
--                  inventing one you would have to keep re-inventing is a lie
--                  you tell yourself quarterly.
--   whenever+optional  30-odd tasks: pen-spinning tricks, dance styles, trips,
--                  things to buy. A wishlist of things never started. Parking is
--                  the opposite: something you WERE doing and stopped.
--   blocked_until / waiting_on  both keep the task VISIBLE, which is the one
--                  thing parking is for avoiding.
--
-- The line that justifies its own view: everything else either returns on its
-- own or stays on screen. A parked task does neither, and a thing that never
-- comes back by itself must have somewhere you go and look, or it is deletion
-- with extra admin.

-- A TIMESTAMP, not a boolean, and it doubles as the flag (parked = NOT NULL).
-- The date is what makes the review worth doing: "parked four months ago" is the
-- sentence that makes you decide, and a boolean cannot say it.
ALTER TABLE tasks ADD COLUMN parked_at TEXT;

-- What would restart it. THIS is the feature, not the flag: her own title
-- carries "reopens only if the author path is ruled an income path", and without
-- somewhere to put that she would keep writing it into titles.
ALTER TABLE tasks ADD COLUMN park_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_parked ON tasks(parked_at);
