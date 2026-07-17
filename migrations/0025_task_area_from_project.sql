-- A task in a project belongs to that project's area. The UI has always assumed
-- it (TaskSheet's section picker sets both together), but nothing enforced it, so
-- any writer that set project_id alone left area_id NULL: chiefly the MCP tools,
-- whose createOneTask inserts exactly the fields it is handed.
--
-- The damage looked cosmetic and random: the area tint and the area dot are keyed
-- off task.area_id, so 53 of 194 tasks in a project rendered untinted with a
-- fallback-coloured dot, sitting beside 141 identical-looking tasks that were
-- tinted. It also quietly broke grouping and filtering by area for those rows.
--
-- Backfill only. The invariant is enforced going forward by enforceProjectArea
-- (src/worker/lib/section.ts), used by routes/tasks.ts and routes/mcp.ts.

UPDATE tasks
   SET area_id = (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id)
 WHERE project_id IS NOT NULL
   AND (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id) IS NOT NULL
   AND (
        area_id IS NULL
     OR area_id <> (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id)
   );
