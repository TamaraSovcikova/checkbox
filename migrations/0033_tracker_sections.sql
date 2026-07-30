-- Cadence sections: group trackers under headings you name ("People", "House",
-- "Health"), because one flat list of everything you keep up with stops being
-- scannable once it holds both your sister and the boiler service.
--
-- The section is a NAME on the tracker, not a foreign key to a sections table:
-- a section has no properties of its own, so a table would buy nothing but
-- cascade rules and orphan handling. Renaming a section is one UPDATE over the
-- rows carrying that name; NULL means ungrouped, which is where every existing
-- tracker starts and where new ones land until moved.
--
-- The ORDER of sections (and any section created before it has members) lives
-- in UserPrefs.cadenceSections, a display concern. The page unions the two, so
-- a section present on trackers but missing from prefs still renders: prefs can
-- never hide data.

ALTER TABLE trackers ADD COLUMN section TEXT;
