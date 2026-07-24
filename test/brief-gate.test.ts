// The morning brief's on/off switch is the push_subscriptions table: Settings'
// Disable deletes every row, Enable adds one. The regression this guards: the
// email digest was gated only on RESEND_API_KEY, so a user who disabled the
// brief kept receiving it by mail every morning. Zero subscriptions must mean
// zero sends, on every channel.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { freshDb, type TestD1, type Db } from "./d1-adapter";
import { sendMorningBrief } from "../src/worker/lib/brief";

const MIGRATIONS = join(__dirname, "..", "migrations");
const USER = "user-a";

describe("sendMorningBrief honors the disable switch", () => {
  let raw: Db;
  let d1: TestD1;
  let fetchCalls: string[];

  beforeEach(() => {
    ({ raw, d1 } = freshDb(MIGRATIONS));
    raw.exec(`INSERT INTO users (id, email) VALUES ('${USER}', 'a@example.com');`);
    fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchCalls.push(String(url));
        return new Response("{}", { status: 200 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  // No VAPID keys in env: the push branch stays out of the way, so the only
  // fetch this could make is the Resend email call.
  const env = () => ({ DB: d1, RESEND_API_KEY: "re_test" }) as any;

  it("zero subscriptions: the brief is off, so no email either", async () => {
    await sendMorningBrief(env());
    expect(fetchCalls).toEqual([]);
  });

  it("with a subscription the email goes out", async () => {
    raw.exec(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, keys)
       VALUES ('s1', '${USER}', 'https://push.example/ep', '{"p256dh":"k","auth":"a"}');`
    );
    await sendMorningBrief(env());
    expect(fetchCalls).toEqual(["https://api.resend.com/emails"]);
  });

  it("disabling (deleting all subscriptions) stops the next morning's email", async () => {
    raw.exec(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, keys)
       VALUES ('s1', '${USER}', 'https://push.example/ep', '{"p256dh":"k","auth":"a"}');`
    );
    raw.exec(`DELETE FROM push_subscriptions WHERE user_id = '${USER}';`);
    await sendMorningBrief(env());
    expect(fetchCalls).toEqual([]);
  });
});
