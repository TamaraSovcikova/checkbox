// The query string listEvents builds. `showDeleted` is the whole point here:
// Google omits cancelled events from a timeMin/timeMax listing unless asked, so a
// full resync could only ever upsert and never prune. Two events cancelled on
// Google days earlier kept their cache rows and kept drawing all-day chips (see
// SESSION_LOG #40). A syncToken listing delivers cancellations regardless.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listEvents } from "../src/worker/lib/gcal";

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    })
  );
});

afterEach(() => vi.unstubAllGlobals());

const paramsOf = (url: string) => new URL(url).searchParams;

describe("listEvents query", () => {
  it("asks for deleted events when told to, so a full sync can prune", async () => {
    await listEvents("tok", "primary", {
      timeMin: "2026-06-17T00:00:00.000Z",
      timeMax: "2026-10-15T00:00:00.000Z",
      showDeleted: true,
    });
    expect(paramsOf(calls[0]).get("showDeleted")).toBe("true");
  });

  it("omits showDeleted when not asked (the incremental path)", async () => {
    await listEvents("tok", "primary", { syncToken: "st-1" });
    expect(paramsOf(calls[0]).get("showDeleted")).toBeNull();
    expect(paramsOf(calls[0]).get("syncToken")).toBe("st-1");
  });

  it("still sends the window and the standard flags", async () => {
    await listEvents("tok", "primary", {
      timeMin: "2026-06-17T00:00:00.000Z",
      timeMax: "2026-10-15T00:00:00.000Z",
      showDeleted: true,
    });
    const p = paramsOf(calls[0]);
    expect(p.get("timeMin")).toBe("2026-06-17T00:00:00.000Z");
    expect(p.get("timeMax")).toBe("2026-10-15T00:00:00.000Z");
    expect(p.get("singleEvents")).toBe("true");
  });

  it("surfaces an expired sync token as SYNC_TOKEN_INVALID", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 410 })));
    await expect(
      listEvents("tok", "primary", { syncToken: "stale" })
    ).rejects.toThrow("SYNC_TOKEN_INVALID");
  });
});
