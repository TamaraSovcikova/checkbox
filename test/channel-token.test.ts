// #11: the calendar webhook only acts on notifications carrying the token we
// minted for that channel.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "node:path";
import { Hono } from "hono";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { calendar } from "../src/worker/routes/calendar";
import { CHANNEL_PREFIX, channelTokenFor, channelTokenValid } from "../src/worker/lib/channel-token";

const SECRET = "0".repeat(64);
const CH = `${CHANNEL_PREFIX}abc`;

describe("channel tokens", () => {
  it("accepts only the token minted for that channel", async () => {
    const t = await channelTokenFor(SECRET, CH);
    expect(await channelTokenValid(SECRET, CH, t)).toBe(true);
    expect(await channelTokenValid(SECRET, `${CHANNEL_PREFIX}other`, t)).toBe(false);
    expect(await channelTokenValid(SECRET, CH, "x".repeat(t.length))).toBe(false);
    expect(await channelTokenValid(SECRET, CH, undefined)).toBe(false);
    expect(await channelTokenValid(undefined, CH, t)).toBe(false);
  });

  it("never accepts a legacy (unprefixed) channel", async () => {
    const t = await channelTokenFor(SECRET, "plain-uuid");
    expect(await channelTokenValid(SECRET, "plain-uuid", t)).toBe(false);
  });
});

describe("POST /webhook", () => {
  let raw: Db;
  let d1: TestD1;
  beforeEach(() => {
    ({ raw, d1 } = freshDb(join(__dirname, "..", "migrations")));
    raw.exec(`
      INSERT INTO users (id, email) VALUES ('u', 'u@example.com');
      INSERT INTO calendar_accounts (id, user_id, google_email, refresh_token_enc, watch_channel_id)
        VALUES ('acc', 'u', 'u@example.com', 'enc', '${CH}');
    `);
  });

  async function hit(token?: string) {
    const waitUntil = vi.fn();
    const res = await new Hono().route("/", calendar).request(
      "/webhook",
      {
        method: "POST",
        headers: {
          "x-goog-channel-id": CH,
          "x-goog-resource-state": "exists",
          ...(token ? { "x-goog-channel-token": token } : {}),
        },
      },
      { DB: d1, CALENDAR_ENCRYPTION_KEY: SECRET } as any,
      { waitUntil, passThroughOnException: () => {} } as any
    );
    return { status: res.status, synced: waitUntil.mock.calls.length > 0 };
  }

  it("syncs on a valid token", async () => {
    expect(await hit(await channelTokenFor(SECRET, CH))).toEqual({ status: 200, synced: true });
  });

  it("does nothing, quietly, without one or with a wrong one", async () => {
    expect(await hit()).toEqual({ status: 200, synced: false });
    expect(await hit("forged")).toEqual({ status: 200, synced: false });
  });
});
