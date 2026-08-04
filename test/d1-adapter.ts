// Minimal D1Database adapter over Node's built-in node:sqlite (Node 22.5+).
// Executes real SQL against an in-memory database so tests genuinely exercise
// the `WHERE user_id = ?` isolation guards — no mocking of query results.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// node:sqlite is a very new builtin that Vite's resolver doesn't know about,
// so require it at runtime to bypass static resolution.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
export type Db = InstanceType<typeof DatabaseSync>;

type Row = Record<string, unknown>;

function clean(args: unknown[]): unknown[] {
  // node:sqlite rejects `undefined` and booleans; coerce to null / 0|1.
  return args.map((a) =>
    a === undefined ? null : typeof a === "boolean" ? (a ? 1 : 0) : a
  );
}

// Cloudflare D1 rejects any single query with more than 100 bound parameters.
// node:sqlite allows far more, so enforce the cap here to reproduce D1 faithfully.
const D1_BIND_LIMIT = 100;

class Stmt {
  private args: unknown[] = [];
  constructor(private db: DatabaseSync, private sql: string) {}
  // D1's bind() returns a NEW statement and leaves the original untouched, which
  // is what makes `const s = db.prepare(sql); db.batch([s.bind(a), s.bind(b)])`
  // write both rows. Binding in place handed batch the same statement twice and
  // silently dropped the first row, so a symmetric write (task_links, 0034)
  // looked half-broken in tests while production was fine. Reproduce D1.
  bind(...args: unknown[]) {
    if (args.length > D1_BIND_LIMIT) {
      throw new Error(
        `D1_ERROR: too many SQL variables (${args.length} > ${D1_BIND_LIMIT})`
      );
    }
    const next = new Stmt(this.db, this.sql);
    next.args = clean(args);
    return next;
  }
  async first<T = Row>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args);
    return (row as T) ?? null;
  }
  async all<T = Row>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.args);
    return { results: rows as T[] };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: r };
  }
}

export class TestD1 {
  constructor(private db: DatabaseSync) {}
  prepare(sql: string) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts: Stmt[]) {
    const out = [];
    for (const s of stmts) out.push(await s.run());
    return out;
  }
}

// Build a fresh in-memory DB with all migrations applied.
export function freshDb(migrationsDir: string): {
  raw: Db;
  d1: TestD1;
} {
  const db = new DatabaseSync(":memory:");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(migrationsDir, f), "utf8"));
  }
  return { raw: db, d1: new TestD1(db) };
}
