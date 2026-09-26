import { Hono } from "hono";
import type { Bindings } from "../db";
import { getUserId } from "../db";
import { buildAuthUrl } from "../lib/gcal";
import {
  issueConnectState,
  consumeConnectState,
  connectFailedPage,
} from "../lib/connect-state";
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
  const state = await issueConnectState(c.env, userId, "calendar");
  const url = buildAuthUrl(c.env.GOOGLE_CLIENT_ID, redirectUri(c.env), state);
  return c.redirect(url);
});

// ── Callback: exchange code and store tokens ───────────────────────────────────

calendar.get("/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const failed = () => c.html(connectFailedPage("Google Calendar", "/calendar"), 400);
  if (error || !code) {
    if (error) console.error("calendar connect declined:", error);
    return failed();
  }
  try {
    const userId = await getUserId(c);
    // Only a flow this user started, in this browser, may attach a calendar.
    if (!(await consumeConnectState(c.env, c.req.query("state"), userId, "calendar"))) {
      console.error("calendar callback: state missing, expired or not this user's");
      return failed();
    }
    await connectCalendar(c.env, userId, code, redirectUri(c.env));
    // Kick off initial sync in the background.
    c.executionCtx?.waitUntil(
      syncCalendar(c.env, userId).catch(console.error)
    );
  } catch (e) {
    console.error("calendar callback error:", e);
    return failed();
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

  // Hide events from calendars the user has toggled off (feeds.enabled = 0).
  // Filter on read so toggling is instant, no re-sync needed; default-visible so
  // nothing hides until explicitly disabled.
  const hidden =
    "calendar_id NOT IN (SELECT calendar_id FROM calendar_feeds WHERE user_id = ? AND enabled = 0)";

  // A finished task has no business on the calendar, so never serve an event we
  // own whose task is done. reconcileTaskEvents deletes those from Google, but
  // that runs on the 15-min sync tick and can fail; until it lands, the cache
  // still holds the row and the all-day box still drew a chip for a task ticked
  // off days ago. Decide it from `tasks`, the table that owns the fact, rather
  // than from the cache, which is window-limited and rebuilt.
  //
  // Scoped to is_checkbox_owned: a real Google event that happens to be linked to
  // a task is not ours to hide.
  const notDone =
    `NOT (is_checkbox_owned = 1 AND task_id IN
       (SELECT id FROM tasks WHERE user_id = ? AND status = 'done'))`;

  const { results } = await c.env.DB.prepare(
    `SELECT id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id, color
     FROM calendar_events_cache
     WHERE user_id = ? AND NOT all_day AND start >= ? AND start < ? AND ${hidden} AND ${notDone}
     UNION ALL
     SELECT id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id, color
     FROM calendar_events_cache
     WHERE user_id = ? AND all_day AND start >= ? AND start < ? AND ${hidden} AND ${notDone}
     ORDER BY start`
  )
    // All-day starts are bare YYYY-MM-DD strings, so match them against the bare
    // date range (not the ISO timestamps): in week view the range spans 7 days,
    // and `start = ?` only ever matched all-day events on the first day, dropping
    // every all-day event mid-week.
    .bind(
      userId, startISO, endISO, userId, userId,
      userId, start, end, userId, userId
    )
    .all();

  return c.json(
    results.map((r) => ({
      ...r,
      all_day: r.all_day === 1,
      is_checkbox_owned: r.is_checkbox_owned === 1,
    }))
  );
});

// ── Per-calendar visibility ───────────────────────────────────────────────────

calendar.get("/feeds", async (c) => {
  const userId = await getUserId(c);
  const { results } = await c.env.DB.prepare(
    `SELECT calendar_id, summary, color, primary_cal, enabled
     FROM calendar_feeds WHERE user_id = ?
     ORDER BY primary_cal DESC, summary COLLATE NOCASE`
  )
    .bind(userId)
    .all();
  return c.json(
    results.map((r) => ({
      calendar_id: r.calendar_id,
      summary: r.summary,
      color: r.color,
      primary: r.primary_cal === 1,
      enabled: r.enabled === 1,
    }))
  );
});

calendar.patch("/feeds/:id", async (c) => {
  const userId = await getUserId(c);
  const calendarId = c.req.param("id");
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  // The primary calendar holds task events and stays on.
  const feed = await c.env.DB.prepare(
    "SELECT primary_cal FROM calendar_feeds WHERE user_id = ? AND calendar_id = ?"
  )
    .bind(userId, calendarId)
    .first<{ primary_cal: number }>();
  if (!feed) return c.json({ error: "unknown calendar" }, 404);
  if (feed.primary_cal === 1 && !enabled)
    return c.json({ error: "primary calendar can't be hidden" }, 400);
  await c.env.DB.prepare(
    "UPDATE calendar_feeds SET enabled = ? WHERE user_id = ? AND calendar_id = ?"
  )
    .bind(enabled ? 1 : 0, userId, calendarId)
    .run();
  return c.json({ ok: true });
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
    c.env.DB.prepare(
      "DELETE FROM calendar_feeds WHERE user_id = ?"
    ).bind(userId),
  ]);
  return c.json({ ok: true });
});
