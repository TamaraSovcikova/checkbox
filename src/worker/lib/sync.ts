// Calendar sync orchestrator.
// Connects D1 calendar_accounts + calendar_events_cache to the Google Calendar API.

import type { Bindings } from "../db";
import { uuid } from "../db";
import {
  decryptToken,
  encryptToken,
  exchangeCode,
  getGoogleEmail,
  getPrimaryCalendarId,
  listCalendars,
  listEvents,
  refreshAccessToken,
  createEvent,
  updateEvent,
  deleteEvent,
  watchCalendar,
  taskToGCalEvent,
  TASK_ID_PROP,
} from "./gcal";

export type CalendarAccount = {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token_enc: string;
  access_token: string | null;
  token_expiry: string | null;
  primary_calendar_id: string | null;
  sync_token: string | null;
  sync_tokens: string | null; // JSON { calendarId: syncToken } for all calendars
  watch_channel_id: string | null;
  watch_expiry: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

// ── Account helpers ────────────────────────────────────────────────────────────

export async function getCalendarAccount(
  env: Bindings,
  userId: string
): Promise<CalendarAccount | null> {
  return env.DB.prepare(
    "SELECT * FROM calendar_accounts WHERE user_id = ? LIMIT 1"
  )
    .bind(userId)
    .first<CalendarAccount>();
}

// What the user wants pushed to Google Calendar. Both default on; only an
// explicit false in prefs turns one off.
async function getGcalSyncPrefs(
  env: Bindings,
  userId: string
): Promise<{ timeBlocks: boolean; dueDates: boolean }> {
  const row = await env.DB.prepare("SELECT prefs FROM users WHERE id = ?")
    .bind(userId)
    .first<{ prefs: string | null }>();
  let p: Record<string, unknown> = {};
  try {
    if (row?.prefs) p = JSON.parse(row.prefs) as Record<string, unknown>;
  } catch {
    p = {};
  }
  return {
    timeBlocks: p.gcalSyncTimeBlocks !== false,
    dueDates: p.gcalSyncDueDates !== false,
  };
}

// ── Sync health ───────────────────────────────────────────────────────────────
//
// Any Google API failure (expired token, API not enabled, revoked scope) breaks
// sync in both directions. Record it on the account so the app can show it,
// instead of only console.error'ing it into the void.

export async function noteCalendarError(
  env: Bindings,
  accountId: string,
  message: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE calendar_accounts SET last_error = ?, last_error_at = ? WHERE id = ?"
  )
    .bind(message.slice(0, 800), new Date().toISOString(), accountId)
    .run()
    .catch(() => {});
}

export async function clearCalendarError(
  env: Bindings,
  accountId: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE calendar_accounts SET last_error = NULL, last_error_at = NULL WHERE id = ?"
  )
    .bind(accountId)
    .run()
    .catch(() => {});
}

export async function getValidAccessToken(
  env: Bindings,
  account: CalendarAccount
): Promise<string> {
  if (account.access_token && account.token_expiry) {
    const expiry = new Date(account.token_expiry).getTime();
    if (Date.now() < expiry - 60_000) return account.access_token;
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google credentials not configured");
  }
  if (!env.CALENDAR_ENCRYPTION_KEY) {
    throw new Error("CALENDAR_ENCRYPTION_KEY not set");
  }
  const refreshToken = await decryptToken(
    env.CALENDAR_ENCRYPTION_KEY,
    account.refresh_token_enc
  );

  let tokens;
  try {
    tokens = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refreshToken
    );
  } catch (e) {
    // A revoked/expired refresh token kills both push and pull. Record it so the
    // app can ask for a reconnect instead of failing silently forever.
    await noteCalendarError(env, account.id, String((e as Error).message));
    throw e;
  }

  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE calendar_accounts SET access_token = ?, token_expiry = ?, last_error = NULL, last_error_at = NULL WHERE id = ?"
  )
    .bind(tokens.access_token, expiry, account.id)
    .run();
  return tokens.access_token;
}

// ── OAuth connect (called from /api/calendar/callback) ────────────────────────

export async function connectCalendar(
  env: Bindings,
  userId: string,
  code: string,
  redirectUri: string
): Promise<void> {
  if (
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.CALENDAR_ENCRYPTION_KEY
  ) {
    throw new Error("Google Calendar not configured");
  }
  const tokens = await exchangeCode(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri,
    code
  );
  const [email, primaryCalId] = await Promise.all([
    getGoogleEmail(tokens.access_token),
    getPrimaryCalendarId(tokens.access_token),
  ]);
  const encRefresh = await encryptToken(
    env.CALENDAR_ENCRYPTION_KEY,
    tokens.refresh_token
  );
  const tokenExpiry = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();

  // Upsert: one Google account per user for now.
  const existing = await getCalendarAccount(env, userId);
  if (existing) {
    await env.DB.prepare(
      `UPDATE calendar_accounts SET
         google_email = ?, refresh_token_enc = ?, access_token = ?,
         token_expiry = ?, primary_calendar_id = ?, sync_token = NULL,
         sync_tokens = NULL
       WHERE id = ?`
    )
      .bind(
        email,
        encRefresh,
        tokens.access_token,
        tokenExpiry,
        primaryCalId,
        existing.id
      )
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO calendar_accounts
         (id, user_id, google_email, refresh_token_enc, access_token, token_expiry, primary_calendar_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        uuid(),
        userId,
        email,
        encRefresh,
        tokens.access_token,
        tokenExpiry,
        primaryCalId
      )
      .run();
  }
}

// ── Incremental pull from Google Calendar into local cache ────────────────────

export async function syncCalendar(
  env: Bindings,
  userId: string
): Promise<void> {
  const account = await getCalendarAccount(env, userId);
  if (!account) return;
  try {
    await syncCalendarInner(env, userId, account);
    // Pull first, then clean up: the pull refreshes the cache this reads, so a
    // task deleted or completed since the last sync is caught here.
    await reconcileTaskEvents(env, userId);
  } catch (e) {
    await noteCalendarError(env, account.id, String((e as Error).message));
    throw e;
  }
  if (account.last_error) await clearCalendarError(env, account.id);
}

type CalToSync = { id: string; color: string | null };

async function syncCalendarInner(
  env: Bindings,
  userId: string,
  account: CalendarAccount
): Promise<void> {
  const accessToken = await getValidAccessToken(env, account);

  // Discover every calendar the user has (needs calendar.readonly). Skip deleted
  // calendars and freeBusy/none access roles whose events we can't read. If the
  // scope isn't granted yet, fall back to primary alone (pre-multi behaviour).
  const list = await listCalendars(accessToken);
  const readable =
    list?.filter(
      (c) =>
        !c.deleted &&
        c.accessRole !== "freeBusyReader" &&
        c.accessRole !== "none"
    ) ?? null;

  if (readable && readable.length > 0) {
    // Record every calendar as a feed so the user can toggle it in Settings.
    // enabled defaults from Google's `selected` the first time we see it, then
    // the user owns it (preserved on conflict).
    await env.DB.batch(
      readable.map((c) =>
        env.DB.prepare(
          `INSERT INTO calendar_feeds
             (user_id, calendar_id, summary, color, primary_cal, enabled)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, calendar_id) DO UPDATE SET
             summary = excluded.summary, color = excluded.color,
             primary_cal = excluded.primary_cal`
        ).bind(
          userId,
          c.id,
          c.summary ?? null,
          c.backgroundColor ?? null,
          c.primary ? 1 : 0,
          c.selected === false ? 0 : 1
        )
      )
    );
  }

  // Only pull the calendars the user has left enabled.
  const { results: feedRows } = readable
    ? await env.DB.prepare(
        "SELECT calendar_id FROM calendar_feeds WHERE user_id = ? AND enabled = 0"
      )
        .bind(userId)
        .all<{ calendar_id: string }>()
    : { results: [] as { calendar_id: string }[] };
  const disabled = new Set(feedRows.map((r) => r.calendar_id));

  const calendars: CalToSync[] =
    readable && readable.length > 0
      ? readable
          .filter((c) => !disabled.has(c.id))
          .map((c) => ({ id: c.id, color: c.backgroundColor ?? null }))
      : [{ id: account.primary_calendar_id ?? "primary", color: null }];

  let tokens: Record<string, string> = {};
  try {
    if (account.sync_tokens) tokens = JSON.parse(account.sync_tokens);
  } catch {
    tokens = {};
  }

  const nextTokens: Record<string, string> = {};
  for (const cal of calendars) {
    try {
      const next = await syncOneCalendar(env, userId, accessToken, cal, tokens[cal.id]);
      // Keep the fresh token, or preserve the old one if none came back.
      if (next) nextTokens[cal.id] = next;
      else if (tokens[cal.id]) nextTokens[cal.id] = tokens[cal.id];
    } catch (e) {
      // One bad calendar must not abort the others. Preserve its previous token
      // so the next run retries incrementally rather than losing all state.
      if (tokens[cal.id]) nextTokens[cal.id] = tokens[cal.id];
      console.error(`sync calendar ${cal.id}:`, (e as Error).message);
    }
  }

  await env.DB.prepare(
    "UPDATE calendar_accounts SET sync_tokens = ? WHERE id = ?"
  )
    .bind(JSON.stringify(nextTokens), account.id)
    .run();
}

// Pull one calendar into the cache. Incremental when a sync token is supplied,
// else a bounded full sync (last 30 days + next 90 days). Returns the calendar's
// next sync token to persist.
async function syncOneCalendar(
  env: Bindings,
  userId: string,
  accessToken: string,
  cal: CalToSync,
  syncToken: string | undefined
): Promise<string | undefined> {
  const fullMin = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const fullMax = new Date(Date.now() + 90 * 86_400_000).toISOString();

  let token = syncToken;
  let timeMin = token ? undefined : fullMin;
  let timeMax = token ? undefined : fullMax;
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    let result;
    try {
      result = await listEvents(accessToken, cal.id, {
        syncToken: token,
        timeMin,
        timeMax,
        pageToken,
      });
    } catch (e) {
      if ((e as Error).message === "SYNC_TOKEN_INVALID") {
        // The stored token expired: restart as a bounded full sync.
        token = undefined;
        timeMin = fullMin;
        timeMax = fullMax;
        pageToken = undefined;
        result = await listEvents(accessToken, cal.id, {
          timeMin: fullMin,
          timeMax: fullMax,
        });
      } else {
        throw e;
      }
    }

    nextSyncToken = result.nextSyncToken;
    pageToken = result.nextPageToken;

    const stmts = (result.items ?? []).map((ev) => {
      if (ev.status === "cancelled") {
        return env.DB.prepare(
          "DELETE FROM calendar_events_cache WHERE gcal_event_id = ? AND calendar_id = ?"
        ).bind(ev.id, cal.id);
      }
      const allDay = !ev.start.dateTime;
      // Normalise to UTC ISO so date range queries work correctly.
      const start = ev.start.dateTime
        ? new Date(ev.start.dateTime).toISOString()
        : (ev.start.date ?? "");
      const end = ev.end?.dateTime
        ? new Date(ev.end.dateTime).toISOString()
        : (ev.end?.date ?? "");
      const taskId = ev.extendedProperties?.private?.[TASK_ID_PROP] ?? null;
      return env.DB.prepare(
        `INSERT INTO calendar_events_cache
           (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, updated, is_checkbox_owned, task_id, color)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(gcal_event_id, calendar_id) DO UPDATE SET
           title = excluded.title, start = excluded.start, end = excluded.end,
           all_day = excluded.all_day, updated = excluded.updated,
           is_checkbox_owned = excluded.is_checkbox_owned, task_id = excluded.task_id,
           color = excluded.color`
      ).bind(
        uuid(),
        userId,
        ev.id,
        cal.id,
        ev.summary ?? null,
        start,
        end,
        allDay ? 1 : 0,
        ev.updated ?? null,
        taskId ? 1 : 0,
        taskId,
        cal.color
      );
    });

    if (stmts.length > 0) await env.DB.batch(stmts);
  } while (pageToken);

  return nextSyncToken;
}

// ── Push a Checkbox task to Google Calendar ───────────────────────────────────

type TaskRow = {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  gcal_event_id: string | null;
  gcal_calendar_id: string | null;
  status: string;
  gcal_hidden: number;
};

// Should this task have an event on Google Calendar right now?
//
// An event is wanted for an enabled time-block or an enabled due date, unless the
// task is hidden. Hiding routes into the same "no event wanted" path that
// unscheduling uses, so it deletes the event we made and stops us re-creating
// one, while leaving the task's dates alone: clearing the flag pushes it back.
//
// Pure and exported so the rule can be tested without a Google account.
export function wantsGcalEvent(
  task: Pick<TaskRow, "gcal_hidden" | "scheduled_start" | "due_date">,
  prefs: { timeBlocks: boolean; dueDates: boolean }
): boolean {
  if (task.gcal_hidden) return false;
  return !!(
    (prefs.timeBlocks && task.scheduled_start) ||
    (prefs.dueDates && task.due_date)
  );
}

export async function pushTaskToGcal(
  env: Bindings,
  taskId: string,
  userId: string
): Promise<void> {
  const account = await getCalendarAccount(env, userId);
  if (!account) return;

  const task = await env.DB.prepare(
    `SELECT id, title, due_date, due_time, scheduled_start, scheduled_end,
            gcal_event_id, gcal_calendar_id, status, gcal_hidden
     FROM tasks WHERE id = ? AND user_id = ?`
  )
    .bind(taskId, userId)
    .first<TaskRow>();

  if (!task) return;

  // User prefs decide what syncs (Settings › Google Calendar). Both default on.
  const syncPrefs = await getGcalSyncPrefs(env, userId);
  const wantEvent = wantsGcalEvent(task, syncPrefs);

  // Nothing to reconcile: no event wanted and none exists.
  if (!wantEvent && !task.gcal_event_id) return;
  // Never create or update an event for a done task. Completing now REMOVES the
  // event outright (see the complete route + reconcileTaskEvents): a finished task
  // should not keep occupying the calendar. Unscheduling below still removes one.
  if (wantEvent && task.status === "done") return;

  const accessToken = await getValidAccessToken(env, account);
  const calendarId = account.primary_calendar_id ?? "primary";

  // Unscheduled (both time-block and due date cleared): delete the owned event
  // and drop the link so a later re-schedule creates a fresh one.
  if (!wantEvent) {
    if (task.gcal_event_id) {
      await deleteEvent(
        accessToken,
        task.gcal_calendar_id ?? calendarId,
        task.gcal_event_id
      ).catch((e) => console.error("gcal delete on unschedule:", e));
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE tasks SET gcal_event_id = NULL, gcal_calendar_id = NULL WHERE id = ?"
        ).bind(task.id),
        env.DB.prepare(
          "DELETE FROM calendar_events_cache WHERE gcal_event_id = ? AND calendar_id = ?"
        ).bind(task.gcal_event_id, task.gcal_calendar_id ?? calendarId),
      ]);
    }
    return;
  }

  // Build a minimal Task-compatible object for the converter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const taskLike = task as any;
  const eventBody = taskToGCalEvent(taskLike, syncPrefs);

  try {
    if (task.gcal_event_id) {
      await updateEvent(
        accessToken,
        task.gcal_calendar_id ?? calendarId,
        task.gcal_event_id,
        eventBody
      );
    } else {
      const ev = await createEvent(accessToken, calendarId, eventBody);
      const start = ev.start.dateTime
        ? new Date(ev.start.dateTime).toISOString()
        : (ev.start.date ?? "");
      const end = ev.end?.dateTime
        ? new Date(ev.end.dateTime).toISOString()
        : (ev.end?.date ?? "");
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE tasks SET gcal_event_id = ?, gcal_calendar_id = ? WHERE id = ?"
        ).bind(ev.id, calendarId, task.id),
        env.DB.prepare(
          `INSERT INTO calendar_events_cache
             (id, user_id, gcal_event_id, calendar_id, title, start, end, all_day, is_checkbox_owned, task_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT(gcal_event_id, calendar_id) DO UPDATE SET
             title = excluded.title, start = excluded.start, end = excluded.end`
        ).bind(
          uuid(),
          userId,
          ev.id,
          calendarId,
          task.title,
          start,
          end,
          ev.start.date ? 1 : 0,
          task.id
        ),
      ]);
    }
  } catch (e) {
    // e.g. 403 "Google Calendar API has not been used in project ... or it is
    // disabled". Record it so the UI can show the real reason.
    await noteCalendarError(env, account.id, String((e as Error).message));
    throw e;
  }

  // A write got through: whatever was wrong is fixed.
  if (account.last_error) await clearCalendarError(env, account.id);
}

// ── Delete a GCal event when a task is removed or unscheduled ─────────────────

// One event Checkbox owns that should not exist any more.
export type StrayTaskEvent = {
  taskId: string | null;
  eventId: string;
  calId: string;
  clearLink: boolean;
};

// WHICH events deserve deleting. Split out from reconcileTaskEvents (which does
// the Google calls) so the selection rules - the part that decides to delete
// something off a real calendar - can be tested against a real database with no
// Google account in sight.
export async function findStrayTaskEvents(
  db: D1Database,
  userId: string,
  fallbackCal: string
): Promise<StrayTaskEvent[]> {
  // FOUR passes, because no single source sees every stray on its own.
  //
  // (a) DONE tasks that still hold an event. The linkage on the task row is
  //     authoritative, so this catches them whether or not the event is cached.
  //     The cache only covers a -30/+90 day window and gets rebuilt, so keying
  //     this off the cache alone silently missed real strays.
  // (b) Cached checkbox-owned events whose task is GONE. A deleted task leaves no
  //     row to read (the FK nulls task_id), so the cache is the only trace here.
  // (c) Cached checkbox-owned events whose task is DONE. The gap between the two
  //     above, and a real one: the complete route NULLs the task's linkage BEFORE
  //     firing the Google delete in the background, so if that delete does not
  //     land, (a) can no longer see the event (linkage gone) and (b) will not
  //     touch it (the task row still exists). The event then lived on Google and
  //     in the cache forever, which is exactly how a done task kept showing a
  //     chip in the all-day box. Found in prod, not theorised: "Prepare for team
  //     lunch", completed 2026-07-16, still had its 2026-07-17 all-day row.
  const done = await db.prepare(
    `SELECT id AS task_id, gcal_event_id, gcal_calendar_id AS calendar_id
       FROM tasks
      WHERE user_id = ? AND status = 'done' AND gcal_event_id IS NOT NULL`
  )
    .bind(userId)
    .all<{ task_id: string; gcal_event_id: string; calendar_id: string | null }>();

  const orphaned = await db.prepare(
    `SELECT c.gcal_event_id, c.calendar_id, c.task_id
       FROM calendar_events_cache c
       LEFT JOIN tasks t ON t.id = c.task_id
      WHERE c.user_id = ? AND c.is_checkbox_owned = 1
        AND (c.task_id IS NULL OR t.id IS NULL)`
  )
    .bind(userId)
    .all<{ gcal_event_id: string; calendar_id: string; task_id: string | null }>();

  const cachedDone = await db.prepare(
    `SELECT c.gcal_event_id, c.calendar_id, c.task_id
       FROM calendar_events_cache c
       JOIN tasks t ON t.id = c.task_id
      WHERE c.user_id = ? AND c.is_checkbox_owned = 1 AND t.status = 'done'`
  )
    .bind(userId)
    .all<{ gcal_event_id: string; calendar_id: string; task_id: string | null }>();

  // (d) SUPERSEDED events: ours, task alive, but the task's linkage names a
  //     DIFFERENT event. A task holds exactly one event (tasks.gcal_event_id is
  //     singular, and pushTaskToGcal either PATCHes that one or creates one and
  //     overwrites the link), so a second owned event for the same task is an
  //     abandoned create that nothing was left pointing at - invisible to (a),
  //     (b) and (c), because the task is neither done nor deleted. Prod had one:
  //     task 7d04c5e5 ("Question: Did it start as the QA-agent thing...") owned
  //     both ai3rclbj (linked) and hmrd4r60 (orphaned), so it drew TWO all-day
  //     chips for one task.
  //
  //     Only fires when the task's own linkage is non-null and differs, so a task
  //     mid-create (linkage still NULL) is never touched.
  const superseded = await db.prepare(
    `SELECT c.gcal_event_id, c.calendar_id, c.task_id
       FROM calendar_events_cache c
       JOIN tasks t ON t.id = c.task_id
      WHERE c.user_id = ? AND c.is_checkbox_owned = 1
        AND t.gcal_event_id IS NOT NULL
        AND c.gcal_event_id <> t.gcal_event_id`
  )
    .bind(userId)
    .all<{ gcal_event_id: string; calendar_id: string; task_id: string | null }>();

  // `clearLink` says whether to NULL the task's gcal linkage after the delete.
  // True when the task should hold no event at all (done, or gone). FALSE for a
  // superseded stray: there the task's link names the event we are KEEPING, so
  // clearing it would abandon the good event and leave the task pointing at
  // nothing - turning a duplicate into a fresh orphan on the next push.
  const targets = [
    ...(done.results ?? []).map((r) => ({
      taskId: r.task_id as string | null,
      eventId: r.gcal_event_id,
      calId: r.calendar_id ?? fallbackCal,
      clearLink: true,
    })),
    ...(orphaned.results ?? []).map((r) => ({
      taskId: r.task_id,
      eventId: r.gcal_event_id,
      calId: r.calendar_id ?? fallbackCal,
      clearLink: true,
    })),
    ...(cachedDone.results ?? []).map((r) => ({
      taskId: r.task_id,
      eventId: r.gcal_event_id,
      calId: r.calendar_id ?? fallbackCal,
      clearLink: true,
    })),
    ...(superseded.results ?? []).map((r) => ({
      taskId: r.task_id,
      eventId: r.gcal_event_id,
      calId: r.calendar_id ?? fallbackCal,
      clearLink: false,
    })),
  ];
  // The passes can name the same event; only act on each once. Order matters:
  // the done/gone passes come first, so an event they claim keeps clearLink.
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = `${t.calId}:${t.eventId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Sweep away Google events Checkbox created that no longer deserve one. SAFETY:
// every pass is scoped to is_checkbox_owned = 1 / a task's own linkage, both of
// which come solely from our checkbox_task_id tag on the event, so a user's own
// calendar entries can never be touched. Runs on every sync, which also cleans up
// strays left behind by older builds that did not remove the event on
// complete/delete. See findStrayTaskEvents for which events qualify and why.
export async function reconcileTaskEvents(
  env: Bindings,
  userId: string
): Promise<number> {
  const account = await getCalendarAccount(env, userId);
  if (!account) return 0;
  const fallbackCal = account.primary_calendar_id ?? "primary";

  const unique = await findStrayTaskEvents(env.DB, userId, fallbackCal);
  if (!unique.length) return 0;

  const accessToken = await getValidAccessToken(env, account);
  let removed = 0;
  for (const t of unique) {
    try {
      await deleteEvent(accessToken, t.calId, t.eventId);
      removed++;
    } catch (e) {
      // A 404/410 just means it is already gone. Fall through and clear our own
      // rows anyway, otherwise a deleted-in-Google event retries forever.
      console.error("reconcileTaskEvents", e);
    }
    await env.DB.prepare(
      "DELETE FROM calendar_events_cache WHERE gcal_event_id = ? AND calendar_id = ?"
    )
      .bind(t.eventId, t.calId)
      .run();
    // Drop the stale linkage so re-opening the task pushes a fresh event. Guarded
    // by gcal_event_id = ? so it can only ever clear a link that still names the
    // event we just deleted, never one repointed at a live event meanwhile.
    if (t.taskId && t.clearLink) {
      await env.DB.prepare(
        `UPDATE tasks SET gcal_event_id = NULL, gcal_calendar_id = NULL
          WHERE id = ? AND user_id = ? AND gcal_event_id = ?`
      )
        .bind(t.taskId, userId, t.eventId)
        .run();
    }
  }
  return removed;
}

export async function deleteTaskGcalEvent(
  env: Bindings,
  gcalEventId: string,
  gcalCalendarId: string | null,
  userId: string
): Promise<void> {
  const account = await getCalendarAccount(env, userId);
  if (!account) return;
  const accessToken = await getValidAccessToken(env, account);
  const calId = gcalCalendarId ?? account.primary_calendar_id ?? "primary";
  await deleteEvent(accessToken, calId, gcalEventId);
  await env.DB.prepare(
    "DELETE FROM calendar_events_cache WHERE gcal_event_id = ? AND calendar_id = ?"
  )
    .bind(gcalEventId, calId)
    .run();
}

// ── Renew push notification watch channel (runs from cron) ────────────────────

export async function renewWatchChannel(
  env: Bindings,
  userId: string
): Promise<void> {
  const account = await getCalendarAccount(env, userId);
  if (!account || !env.WORKER_URL) return;

  if (account.watch_expiry) {
    const expiry = new Date(account.watch_expiry).getTime();
    if (Date.now() < expiry - 86_400_000) return; // still good for > 24 h
  }

  const accessToken = await getValidAccessToken(env, account);
  const calendarId = account.primary_calendar_id ?? "primary";
  const channelId = uuid();

  try {
    const ch = await watchCalendar(
      accessToken,
      calendarId,
      channelId,
      `${env.WORKER_URL}/api/calendar/webhook`
    );
    await env.DB.prepare(
      "UPDATE calendar_accounts SET watch_channel_id = ?, watch_expiry = ? WHERE id = ?"
    )
      .bind(channelId, new Date(Number(ch.expiration)).toISOString(), account.id)
      .run();
  } catch (e) {
    console.error("renewWatchChannel:", e);
  }
}
