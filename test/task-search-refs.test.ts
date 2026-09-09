// Searching for what an agent actually said.
//
// Her follow-up: "but the ids that it talks to me with is e.g. d801b76c and I
// need to be able to search that one in the search task." The short codes fix
// what agents say from now on; they do nothing for the conversations she has
// already had, or for a client whose context predates them. Search has to accept
// what she can paste out of a chat.

import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { tasks as tasksRoute } from "../src/worker/routes/tasks";
import { looksLikeIdPrefix } from "../src/shared/taskCode";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";
const TOKEN = "tok-a";

let raw: Db;
let d1: TestD1;
let app: Hono<any>;

beforeEach(() => {
  ({ raw, d1 } = freshDb(MIGRATIONS));
  raw.exec(`
    INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');
    INSERT INTO mcp_tokens (token, user_id) VALUES ('${TOKEN}', '${USER}');
    INSERT INTO tasks (id, user_id, title, status) VALUES
      ('d801b76c-1111-4222-8333-444444444444', '${USER}', 'Book the tickets', 'todo'),
      ('d801b76c-9999-4222-8333-444444444444', '${USER}', 'Twin prefix', 'todo'),
      ('ffffffff-0000-4000-8000-000000000000', '${USER}', 'Renew the passport', 'todo'),
      ('aaaaaaaa-0000-4000-8000-000000000000', '${USER}', 'Finished thing', 'done');
  `);
  app = new Hono();
  app.route("/", tasksRoute);
});

const search = async (q: string): Promise<string[]> => {
  const res = await app.request(
    `/search?q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
    { DB: d1 } as any
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as any[]).map((t) => t.title).sort();
};

describe("looksLikeIdPrefix", () => {
  it("accepts a uuid fragment, which is the thing agents quote", () => {
    expect(looksLikeIdPrefix("d801b76c")).toBe(true);
    expect(looksLikeIdPrefix("d801b76c-1111")).toBe(true);
  });

  it("needs four characters, so a short word is not a lookup", () => {
    // "cafe" and "dead" are hex. "ace" is not long enough to be worth the risk
    // of hijacking a title search.
    expect(looksLikeIdPrefix("ace")).toBe(false);
    expect(looksLikeIdPrefix("cafe")).toBe(true);
  });

  it("leaves plain words and bare numbers alone", () => {
    // A bare number is a CODE (CB-142), handled separately.
    expect(looksLikeIdPrefix("tickets")).toBe(false);
    expect(looksLikeIdPrefix("142")).toBe(false);
    expect(looksLikeIdPrefix("")).toBe(false);
  });
});

describe("searching by what an agent said", () => {
  it("finds a task from the front block of its uuid", async () => {
    expect(await search("d801b76c")).toEqual(["Book the tickets", "Twin prefix"]);
  });

  it("narrows as the fragment gets longer", async () => {
    expect(await search("d801b76c-1111")).toEqual(["Book the tickets"]);
  });

  it("takes the whole uuid too", async () => {
    expect(await search("ffffffff-0000-4000-8000-000000000000")).toEqual([
      "Renew the passport",
    ]);
  });

  it("finds a DONE task by its id, unlike by its text", async () => {
    // Pasting an exact identifier is asking for one specific task. Answering
    // "no results" because it was finished is unhelpful when what she wants is
    // to look at it.
    expect(await search("aaaaaaaa")).toEqual(["Finished thing"]);
    expect(await search("Finished")).toEqual([]);
  });

  it("still searches text, and is case-insensitive about the fragment", async () => {
    expect(await search("tickets")).toEqual(["Book the tickets"]);
    expect(await search("D801B76C-1111")).toEqual(["Book the tickets"]);
  });

  it("finds by short code as well, ranked above a text match", async () => {
    const res = await app.request(
      "/search?q=CB-3",
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any
    );
    const titles = ((await res.json()) as any[]).map((t) => t.title);
    expect(titles[0]).toBe("Renew the passport");
  });
});

describe("resolving a fragment to ONE task", () => {
  const ref = async (prefix: string) =>
    app.request(
      `/ref/${prefix}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
      { DB: d1 } as any
    );

  it("opens the task when the fragment names exactly one", async () => {
    const res = await ref("ffffffff");
    expect(res.status).toBe(200);
    expect((await res.json()).title).toBe("Renew the passport");
  });

  it("refuses an AMBIGUOUS fragment rather than opening the first match", async () => {
    // Acting on the wrong task is worse than saying the reference was unclear.
    const res = await ref("d801b76c");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("ambiguous");
  });

  it("404s on a fragment that matches nothing", async () => {
    expect((await ref("beefbeef")).status).toBe(404);
  });
});
