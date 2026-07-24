// Two-way vault sync. The pure halves (line parse/render, the pull 2x2) and
// the MCP tools end to end against a real DB: pull applies vault edits,
// conflicts resolve vault-wins-on-done / Checkbox-wins-on-date and are
// reported, writebacks compute the minimal line edit and confirm clears dirty.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { parseVaultLine, renderVaultLine, pullDecision } from "../src/shared/vault";
import { mcp } from "../src/worker/routes/mcp";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

// ── Pure: parse ───────────────────────────────────────────────────────────────

describe("parseVaultLine", () => {
  it("parses unchecked and checked boxes, any bullet", () => {
    expect(parseVaultLine("- [ ] renew passport")).toMatchObject({ checked: false });
    expect(parseVaultLine("* [x] renew passport")).toMatchObject({ checked: true });
    expect(parseVaultLine("  + [X] indented")).toMatchObject({ checked: true });
  });

  it("extracts the Obsidian Tasks due date and #now", () => {
    const p = parseVaultLine("- [ ] file taxes 📅 2026-08-01 #now");
    expect(p).toMatchObject({ checked: false, due_date: "2026-08-01", now: true });
  });

  it("returns null for non-task lines", () => {
    expect(parseVaultLine("just prose")).toBeNull();
    expect(parseVaultLine("- a plain bullet")).toBeNull();
    expect(parseVaultLine("-[ ] no space after dash")).toBeNull();
  });
});

// ── Pure: render ──────────────────────────────────────────────────────────────

describe("renderVaultLine", () => {
  it("flips only the checkbox char, preserving everything else", () => {
    expect(
      renderVaultLine("- [ ] call mum #family ⏫ 📅 2026-08-01", { checked: true, due_date: "2026-08-01" })
    ).toBe("- [x] call mum #family ⏫ 📅 2026-08-01");
  });

  it("updates, appends and removes the due token", () => {
    expect(renderVaultLine("- [ ] a 📅 2026-08-01", { checked: false, due_date: "2026-09-15" })).toBe(
      "- [ ] a 📅 2026-09-15"
    );
    expect(renderVaultLine("- [ ] a", { checked: false, due_date: "2026-09-15" })).toBe(
      "- [ ] a 📅 2026-09-15"
    );
    expect(renderVaultLine("- [ ] a 📅 2026-08-01 #tag", { checked: false, due_date: null })).toBe(
      "- [ ] a #tag"
    );
  });

  it("preserves indentation and refuses non-task lines", () => {
    expect(renderVaultLine("    - [ ] nested", { checked: true, due_date: null })).toBe(
      "    - [x] nested"
    );
    expect(renderVaultLine("prose", { checked: true, due_date: null })).toBeNull();
  });
});

// ── Pure: the pull 2x2 ────────────────────────────────────────────────────────

describe("pullDecision", () => {
  it("covers the 2x2", () => {
    expect(pullDecision("- [x] a", "- [ ] a", false).kind).toBe("apply_vault");
    expect(pullDecision("- [x] a", "- [ ] a", true).kind).toBe("conflict");
    expect(pullDecision("- [ ] a", "- [ ] a", true).kind).toBe("writeback_pending");
    expect(pullDecision("- [ ] a", "- [ ] a", false).kind).toBe("in_sync");
  });

  it("no stored text counts as changed (first contact applies the vault)", () => {
    expect(pullDecision("- [ ] a", null, false).kind).toBe("apply_vault");
  });
});

// ── The MCP tools against a real DB ───────────────────────────────────────────

describe("vault sync MCP tools", () => {
  let raw: Db;
  let d1: TestD1;
  let app: Hono<any>;

  beforeEach(() => {
    ({ raw, d1 } = freshDb(MIGRATIONS));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
      INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    `);
    app = new Hono();
    app.route("/", mcp);
  });

  function seed(id: string, over: Record<string, unknown> = {}) {
    const base = {
      status: "todo",
      due_date: null,
      source_path: "Daily/2026-07-23.md",
      source_line: 4,
      source_text: `- [ ] ${id}`,
      vault_dirty: 0,
      ...over,
    };
    raw
      .prepare(
        `INSERT INTO tasks (id, user_id, title, status, due_date, source_path,
           source_line, source_text, vault_dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id, USER, id, base.status, base.due_date, base.source_path,
        base.source_line, base.source_text, base.vault_dirty
      );
  }

  async function call(name: string, args: Record<string, unknown> = {}) {
    const res = await app.request(
      "/",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      },
      { DB: d1 } as any
    );
    return ((await res.json()) as any).result?.content?.[0]?.text as string;
  }

  const row = (id: string) =>
    raw
      .prepare(
        `SELECT status, due_date, planned_date, source_text, source_line, vault_dirty
           FROM tasks WHERE id = ?`
      )
      .get(id) as any;

  it("pull: a vault-side tick completes the task and stores the new line", async () => {
    // The line is edited IN PLACE (same line number): the text no longer
    // matches, so the line-number fallback carries the link.
    seed("t1");
    const out = await call("sync_vault_tasks", {
      items: [{ path: "Daily/2026-07-23.md", line: 4, text: "- [x] t1" }],
    });
    expect(out).toContain("1 applied");
    const r = row("t1");
    expect(r.status).toBe("done");
    expect(r.source_text).toBe("- [x] t1");
    expect(r.vault_dirty).toBe(0);
  });

  it("pull: an UNCHANGED line that moved lines re-links by exact text", async () => {
    seed("t1b", { source_line: 4, source_text: "- [ ] t1b" });
    const out = await call("sync_vault_tasks", {
      items: [{ path: "Daily/2026-07-23.md", line: 30, text: "- [ ] t1b" }],
    });
    expect(out).toContain("0 unmatched");
    expect(row("t1b").source_line).toBe(30);
  });

  it("pull: a vault-side date and #now apply to a clean task", async () => {
    seed("t2");
    await call("sync_vault_tasks", {
      items: [{ path: "Daily/2026-07-23.md", line: 4, text: "- [ ] t2 📅 2026-08-05 #now" }],
    });
    const r = row("t2");
    expect(r.status).toBe("todo");
    expect(r.due_date).toBe("2026-08-05");
    expect(r.planned_date).toBeTruthy();
  });

  it("pull: conflict keeps vault's done-state, Checkbox's date, stays dirty, reports", async () => {
    seed("t3", { due_date: "2026-09-01", vault_dirty: 1 });
    const out = await call("sync_vault_tasks", {
      items: [{ path: "Daily/2026-07-23.md", line: 4, text: "- [x] t3 📅 2026-08-05" }],
    });
    expect(out).toContain("CONFLICT");
    const r = row("t3");
    expect(r.status).toBe("done"); // vault won on done-state
    expect(r.due_date).toBe("2026-09-01"); // Checkbox kept its date
    expect(r.vault_dirty).toBe(1); // writeback will push the date to the note
  });

  it("pull: unmatched lines are reported, untouched tasks stay untouched", async () => {
    seed("t4");
    const out = await call("sync_vault_tasks", {
      items: [{ path: "Other/note.md", line: 1, text: "- [ ] a stranger" }],
    });
    expect(out).toContain("1 unmatched");
    expect(row("t4").status).toBe("todo");
  });

  it("writeback: lists the minimal edit for dirty tasks, confirm clears the flag", async () => {
    seed("t5", { status: "done", due_date: "2026-08-09", vault_dirty: 1 });
    const listing = await call("list_vault_writebacks");
    expect(listing).toContain("- [ ] t5");
    expect(listing).toContain("- [x] t5 📅 2026-08-09");

    const out = await call("confirm_vault_writebacks", {
      items: [{ id: "t5", new_text: "- [x] t5 📅 2026-08-09", new_line: 12 }],
    });
    expect(out).toContain("Confirmed 1");
    const r = row("t5");
    expect(r.vault_dirty).toBe(0);
    expect(r.source_text).toBe("- [x] t5 📅 2026-08-09");
    expect(r.source_line).toBe(12);
  });

  it("writeback: nothing dirty means nothing listed", async () => {
    seed("t6");
    expect(await call("list_vault_writebacks")).toContain("Nothing to write back");
  });

  it("dirty flag: completing a vault-born task in the app marks it, plain tasks not", async () => {
    seed("t7");
    raw
      .prepare(`INSERT INTO tasks (id, user_id, title, status) VALUES ('plain', ?, 'plain', 'todo')`)
      .run(USER);
    await call("complete_task", { id: "t7" });
    await call("complete_task", { id: "plain" });
    expect(row("t7").vault_dirty).toBe(1);
    expect((raw.prepare("SELECT vault_dirty FROM tasks WHERE id = 'plain'").get() as any).vault_dirty).toBe(0);
  });
});
