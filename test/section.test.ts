// The invariant: a task in a project belongs to that project's area. Nothing
// enforced it, so the MCP tools (which insert exactly the fields handed to them)
// left area_id NULL when a caller named a project alone, and 53 tasks rendered
// untinted next to identical tinted ones. enforceProjectArea is what keeps the
// stored data honest going forward; this pins its rules against a real database.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { enforceProjectArea } from "../src/worker/lib/section";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const AREA = "area-fin";
const PROJECT = "proj-tax";

let raw: Db;
let d1: TestD1;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO areas (id, user_id, name) VALUES ('${AREA}', '${USER}', 'Finance');
    INSERT INTO projects (id, user_id, area_id, name) VALUES ('${PROJECT}', '${USER}', '${AREA}', 'Tax');
  `);
});

const run = (body: Record<string, unknown>) =>
  enforceProjectArea(d1 as any, USER, body);

describe("enforceProjectArea", () => {
  it("fills the area from the project when the caller gave none", async () => {
    const b = await run({ title: "x", project_id: PROJECT });
    expect(b.area_id).toBe(AREA);
  });

  it("OVERRIDES a wrong area the caller supplied", async () => {
    // There is no legitimate "project P but area Q"; letting it stand is the drift.
    const b = await run({ project_id: PROJECT, area_id: "some-other-area" });
    expect(b.area_id).toBe(AREA);
  });

  it("leaves the body alone when no project is named", async () => {
    const b = await run({ title: "x", area_id: "kept" });
    expect(b.area_id).toBe("kept");
    expect("area_id" in b).toBe(true);
  });

  it("does not touch area_id when project_id is explicitly null", async () => {
    // Moved to an area or the Backlog: the caller's area_id is the intent.
    const b = await run({ project_id: null, area_id: "kept" });
    expect(b.area_id).toBe("kept");
  });

  it("leaves an unknown project's body untouched, for the caller to reject", async () => {
    const b = await run({ project_id: "nope", area_id: "kept" });
    expect(b.area_id).toBe("kept");
  });

  it("never crosses users: another user's project is treated as unknown", async () => {
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('user-b', 'b@example.com');
      INSERT INTO areas (id, user_id, name) VALUES ('area-b', 'user-b', 'Theirs');
      INSERT INTO projects (id, user_id, area_id, name) VALUES ('proj-b', 'user-b', 'area-b', 'B');
    `);
    const b = await run({ project_id: "proj-b", area_id: "mine" });
    expect(b.area_id).toBe("mine"); // not pulled across to area-b
  });

  it("handles a project that itself has no area", async () => {
    raw.exec(
      `INSERT INTO projects (id, user_id, area_id, name) VALUES ('proj-none', '${USER}', NULL, 'Loose')`
    );
    const b = await run({ project_id: "proj-none", area_id: "was" });
    expect(b.area_id).toBeNull();
  });
});

// The migration that repaired the existing 53. Run its SQL against a seeded DB
// and confirm it aligns exactly the rows it should, and nothing else.
describe("migration 0025 backfill", () => {
  const SQL = `
    UPDATE tasks
       SET area_id = (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id)
     WHERE project_id IS NOT NULL
       AND (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id) IS NOT NULL
       AND (area_id IS NULL
         OR area_id <> (SELECT p.area_id FROM projects p WHERE p.id = tasks.project_id));`;

  it("fills orphaned area, fixes a mismatch, leaves correct and area-less rows", () => {
    raw.exec(`
      INSERT INTO areas (id, user_id, name) VALUES ('area-other', '${USER}', 'Other');
      INSERT INTO projects (id, user_id, area_id, name) VALUES ('proj-loose', '${USER}', NULL, 'Loose');
      INSERT INTO tasks (id, user_id, title, status, project_id, area_id) VALUES
        ('orphan',   '${USER}', 'o', 'todo', '${PROJECT}', NULL),
        ('mismatch', '${USER}', 'm', 'todo', '${PROJECT}', 'area-other'),
        ('correct',  '${USER}', 'c', 'todo', '${PROJECT}', '${AREA}'),
        ('loose',    '${USER}', 'l', 'todo', 'proj-loose', NULL),
        ('no-proj',  '${USER}', 'n', 'todo', NULL, NULL);
    `);
    raw.exec(SQL);
    const rows = raw
      .prepare("SELECT id, area_id FROM tasks ORDER BY id")
      .all() as { id: string; area_id: string | null }[];
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.area_id]));
    expect(byId.orphan).toBe(AREA);
    expect(byId.mismatch).toBe(AREA);
    expect(byId.correct).toBe(AREA);
    expect(byId.loose).toBeNull(); // project has no area to inherit
    expect(byId["no-proj"]).toBeNull(); // no project at all
  });
});
