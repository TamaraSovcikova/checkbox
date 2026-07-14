import { Hono } from "hono";
import type { Bindings } from "../db";
import { getUserId } from "../db";
import { buildAuthUrl } from "../lib/gcal";
import {
  connectCalendar,
  getCalendarAccount,
  syncCalendar,
} from "../lib/sync";

export const calendar = new Hono<{ Bindings: Bindings }>();

function redirectUri(env: Bindings): string {
  return `${env.WORKER_URL}/api/calendar/callback`;
}

// ── Status ────────────────────────────────────────────────────────────────────

// Two very different failures both leave the account row in place and break sync:
// an expired/revoked token (fix: reconnect) and the Calendar API not being enabled
// on the Google Cloud project (fix: enable it, reconnecting will not help).
// Classify so the UI can give the right instruction instead of a generic error.
function classifyCalendarError(err: string | null) {
  if (!err) return { kind: null as null | string, activation_url: null as string | null };
  if (/invalid_grant|expired or revoked|unauthorized|401/i.test(err)) {
    return { kind: "auth", activation_url: null };
  }
  if (/has not been used in project|accessNotConfigured|is disabled/i.test(err)) {
    const m = err.match(
      /https:\/\/console\.developers\.google\.com\/apis\/api\/calendar-json\.googleapis\.com\/overview\?project=\d+/
    );
    return { kind: "api_disabled", activation_url: m ? m[0] : null };
  }
  return { kind: "other", activation_url: null };
}

calendar.get("/status", async (c) => {
  const userId = await getUserId(c);
  const account = await getCalendarAccount(c.env, userId);
  const { kind, activation_url } = classifyCalendarError(account?.last_error ?? null);
  return c.json({
    connected: !!account,
    google_email: account?.google_email ?? null,
    primary_calendar_id: account?.primary_calendar_id ?? null,
    // Sync is broken while last_error is set, whatever the cause.
    sync_broken: !!account?.last_error,
    error_kind: kind,
    activation_url,
    last_error: account?.last_error ?? null,
    last_error_at: account?.last_error_at ?? null,
  });
});

// ── Connect: redirect to Google OAuth ────────────────────────────────────────

calendar.get("/connect", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) {
    return c.json({ error: "Google Calendar not configured" }, 503);
  }
  const userId = await getUserId(c);
  const url = buildAuthUrl(c.env.GOOGLE_CLIENT_ID, redirectUri(c.env), userId);
  return c.redirect(url);
});

// ── Callback: exchange code and store tokens ───────────────────────────────────

calendar.get("/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  if (error || !code) {
    return c.html(
      `<p>Calendar connection failed: ${error ?? "no code"}. <a href="/calendar">Go back</a></p>`
    );
  }
  try {
    const userId = await getUserId(c);
    await connectCalendar(c.env, userId, code, redirectUri(c.env));
    // Kick off initial sync in the background.
    c.executionCtx?.waitUntil(
      syncCalendar(c.env, userId).catch(console.error)
    );
  } catch (e) {
    console.error("calendar callback error:", e);
    return c.html(
      `<p>Connection error: ${(e as Error).message}. <a href="/calendar">Go back</a></p>`
    );
  }
  return c.redirect("/calendar");
});

// ── Manual sync ───────────────────────────────────────────────────────────────

calendar.post("/sync", async (c) => {
  const userId = await getUserId(c);
  const account = await getCalendarAccount(c.env, userId);
  if (!account) return c.json({ error: "No calendar connected" }, 400);
  await syncCalendar(c.env, userId);
  return c.json({ ok: true });
});

// ── Webhook (Google push notifications) ───────────────────────────────────────

calendar.post("/webhook", async (c) => {
  const channelId = c.req.header("x-goog-channel-id");
  const state = c.req.header("x-goog-resource-state");
  if (!channelId || state === "sync") return c.json({ ok: true });

  // Find the user whose watch channel this is.
  const row = await c.env.DB.prepare(
    "SELECT user_id FROM calendar_accounts WHERE watch_channel_id = ? LIMIT 1"
  )
    .bind(channelId)
    .first<{ user_id: string }>();

  if (row) {
    c.executionCtx?.waitUntil(
      syncCalendar(c.env, row.user_id).catch(console.error)
    );
  }
  return c.json({ ok: true });
});

// ── Events for a date range (from local cache) ────────────────────────────────

calendar.get("/events", async (c) => {
  const userId = await getUserId(c);
  const start = c.req.query("start"); // YYYY-MM-DD
  const end = c.req.query("end"); // YYYY-MM-DD (exclusive)
  if (!start || !end)
    return c.json({ error: "start and end required" }, 400);

  // UTC boundaries for the requested date range.
  const startISO = new Date(start + "T00:00:00.000Z").toISOString();
  const endISO = new Date(end + "T00:00:00.000Z").toISOString();

  const { results } = await c.env.DB.prepare(
    `SELECT id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id, color
     FROM calendar_events_cache
     WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ?
     UNION ALL
     SELECT id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id, color
     FROM calendar_events_cache
     WHERE user_id = ? AND all_day AND start >= ? AND start < ?
     ORDER BY start`
  )
    // All-day starts are bare YYYY-MM-DD strings, so match them against the bare
    // date range (not the ISO timestamps): in week view the range spans 7 days,
    // and `start = ?` only ever matched all-day events on the first day, dropping
    // every all-day event mid-week.
    .bind(userId, startISO, endISO, userId, start, end)
    .all();

  return c.json(
    results.map((r) => ({
      ...r,
      all_day: r.all_day === 1,
      is_checkbox_owned: r.is_checkbox_owned === 1,
    }))
  );
});

// ── Disconnect ────────────────────────────────────────────────────────────────

calendar.delete("/disconnect", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM calendar_accounts WHERE user_id = ?"
    ).bind(userId),
    c.env.DB.prepare(
      "DELETE FROM calendar_events_cache WHERE user_id = ?"
    ).bind(userId),
  ]);
  return c.json({ ok: true });
});
