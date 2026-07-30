// Cadence sections: the grouping rules (shared/cadenceSections) and the two
// stores staying honest. Membership is trackers.section; ORDER and empty
// sections live in prefs. The union rule is the safety property: prefs must
// never be able to hide a tracker.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { groupBySection, sectionNames } from "../src/shared/cadenceSections";
import { trackers } from "../src/worker/routes/trackers";
import { prefs } from "../src/worker/routes/prefs";

const t = (name: string, section: string | null = null) => ({ name, section });

describe("groupBySection", () => {
  it("orders by the registry, then data-only sections alphabetically, ungrouped last", () => {
    const items = [t("mum", "People"), t("boiler", "House"), t("wild", "Zed"), t("loose")];
    expect(groupBySection(items, ["House", "People"]).map((g) => g.name)).toEqual([
      "House",
      "People",
      "Zed",
      null,
    ]);
  });

  it("renders a registered section that has no members yet", () => {
    const g = groupBySection([t("mum", "People")], ["People", "Empty"]);
    expect(g.map((x) => x.name)).toEqual(["People", "Empty"]);
    expect(g[1].items).toEqual([]);
  });

  it("NEVER hides a tracker whose section is missing from the registry", () => {
    const g = groupBySection([t("mum", "Ghost")], []);
    expect(g.map((x) => x.name)).toEqual(["Ghost"]);
    expect(g[0].items).toHaveLength(1);
  });

  it("no sections at all: one ungrouped bucket", () => {
    expect(groupBySection([t("a"), t("b")], []).map((g) => g.name)).toEqual([null]);
  });

  it("empty input yields nothing, not an empty ungrouped heading", () => {
    expect(groupBySection([], [])).toEqual([]);
  });

  it("whitespace-only sections count as ungrouped; duplicate registry entries collapse", () => {
    expect(groupBySection([t("a", "   ")], []).map((g) => g.name)).toEqual([null]);
    expect(groupBySection([t("a", "P")], ["P", "P"]).map((g) => g.name)).toEqual(["P"]);
  });

  it("preserves member order within a section (the caller's urgency sort)", () => {
    const items = [t("first", "P"), t("second", "P")];
    expect(groupBySection(items, ["P"])[0].items.map((i) => i.name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("sectionNames lists every section in render order, without null", () => {
    const items = [t("a", "Zed"), t("b", "House"), t("c")];
    expect(sectionNames(items, ["House"])).toEqual(["House", "Zed"]);
  });
});

describe("persistence", () => {
  const U = "user-a";
  const TOKEN = "tok-a";
  let raw: Db;
  let d1: TestD1;
  let app: Hono<any>;

  beforeEach(() => {
    ({ raw, d1 } = freshDb(join(__dirname, "..", "migrations")));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('${U}', 'a@example.com');
      INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${U}');
      INSERT INTO trackers (id, user_id, name, kind, created_at)
        VALUES ('tr1', '${U}', 'Mum', 'contact', '2026-07-01T00:00:00Z');
    `);
    app = new Hono();
    app.route("/api/trackers", trackers);
    app.route("/api/prefs", prefs);
  });

  const req = (path: string, init?: RequestInit) =>
    app.request(
      path,
      {
        ...init,
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      },
      { DB: d1 } as any
    );

  it("a tracker's section round-trips through PATCH and back out of the list", async () => {
    const res = await req("/api/trackers/tr1", {
      method: "PATCH",
      body: JSON.stringify({ section: "People" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).section).toBe("People");
    const list = (await (await req("/api/trackers")).json()) as any[];
    expect(list[0].section).toBe("People");
  });

  it("clearing the section ungroups the tracker", async () => {
    await req("/api/trackers/tr1", { method: "PATCH", body: JSON.stringify({ section: "P" }) });
    const res = await req("/api/trackers/tr1", {
      method: "PATCH",
      body: JSON.stringify({ section: null }),
    });
    expect((await res.json()).section).toBeNull();
  });

  it("the prefs registry round-trips, trimming blanks and duplicates", async () => {
    await req("/api/prefs", {
      method: "PUT",
      body: JSON.stringify({
        hiddenViews: [],
        viewOrder: [],
        cadenceSections: ["People", " House ", "People", "", 7],
      }),
    });
    const loaded = (await (await req("/api/prefs")).json()) as any;
    expect(loaded.cadenceSections).toEqual(["People", "House"]);
  });

  it("never having used sections leaves the registry undefined", async () => {
    await req("/api/prefs", {
      method: "PUT",
      body: JSON.stringify({ hiddenViews: [], viewOrder: [] }),
    });
    expect((await (await req("/api/prefs")).json()).cadenceSections).toBeUndefined();
  });
});
