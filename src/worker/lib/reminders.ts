// Due-time reminders: the 15-minute cron sweeps for open tasks whose due time
// has just passed and pushes once per task (reminder_sent_at is the guard).
// Push is data-less (see lib/push.ts), so the SW fetches /api/push/notify-data
// to learn what to show; a freshly-marked reminder wins over the brief there.

import type { Bindings } from "../db";
import { sendPush, type PushSub } from "./push";
import { reminderDue, type RemindableTask } from "../../shared/reminder";

const TZ = "Europe/Brussels";

function brusselsToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 10);
}

function brusselsHHMM(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export async function sendDueReminders(env: Bindings, userId: string): Promise<number> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY_JWK) return 0;

  const today = brusselsToday();
  const nowHHMM = brusselsHHMM();

  // Narrow in SQL, decide in the shared pure function, so the cron and the
  // tests apply the exact same rule.
  const { results } = await env.DB.prepare(
    `SELECT id, status, due_date, due_time, reminder_sent_at FROM tasks
       WHERE user_id = ? AND status != 'done'
         AND due_date = ? AND due_time IS NOT NULL AND reminder_sent_at IS NULL`
  )
    .bind(userId, today)
    .all<RemindableTask & { id: string }>();

  const due = (results ?? []).filter((t) => reminderDue(t, today, nowHHMM));
  if (due.length === 0) return 0;

  const { results: subRows } = await env.DB.prepare(
    "SELECT endpoint, keys FROM push_subscriptions WHERE user_id = ?"
  )
    .bind(userId)
    .all<{ endpoint: string; keys: string }>();

  // Mark BEFORE pushing: a failed push costs one missed buzz, but marking after
  // a successful push risks a duplicate on partial failure, and duplicates are
  // the worse failure for a notification.
  const ts = new Date().toISOString();
  for (const t of due) {
    await env.DB.prepare(
      "UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND user_id = ?"
    )
      .bind(ts, t.id, userId)
      .run();
  }

  if (subRows.length > 0) {
    const subs: PushSub[] = subRows.map((r) => ({
      endpoint: r.endpoint,
      keys: JSON.parse(r.keys),
    }));
    await sendPush(subs, env).catch(console.error);
  }
  return due.length;
}
