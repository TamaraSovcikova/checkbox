// Morning brief: gather today's tasks, send Web Push + Resend email digest.
// Called by the 06:00 cron trigger.

import type { Bindings } from "../db";
import { sendPush, type PushSub } from "./push";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function todayBrussels(): string {
  return new Date()
    .toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }) // YYYY-MM-DD
    .slice(0, 10);
}

export async function sendMorningBrief(env: Bindings): Promise<void> {
  const { results: users } = await env.DB.prepare(
    "SELECT id, email FROM users"
  ).all<{ id: string; email: string }>();

  for (const user of users) {
    const today = todayBrussels();

    const { results: tasks } = await env.DB.prepare(
      `SELECT title, priority, due_date, due_time
       FROM tasks
       WHERE user_id = ?
         AND status != 'done'
         AND due_date IS NOT NULL
         AND due_date <= ?
       ORDER BY due_time NULLS LAST, priority`
    )
      .bind(user.id, today)
      .all<{
        title: string;
        priority: number;
        due_date: string;
        due_time: string | null;
      }>();

    const total = tasks.length;
    const urgent = tasks.filter((t) => t.priority <= 2).length;
    const overdue = tasks.filter((t) => t.due_date < today).length;

    // ── Push notification ──────────────────────────────────────────────────────

    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY_JWK) {
      const { results: subRows } = await env.DB.prepare(
        "SELECT endpoint, keys FROM push_subscriptions WHERE user_id = ?"
      )
        .bind(user.id)
        .all<{ endpoint: string; keys: string }>();

      const subs: PushSub[] = subRows.map((r) => ({
        endpoint: r.endpoint,
        keys: JSON.parse(r.keys),
      }));

      if (subs.length > 0) {
        await sendPush(subs, env).catch(console.error);
      }
    }

    // ── Resend email digest ────────────────────────────────────────────────────

    if (!env.RESEND_API_KEY || !user.email || user.email.includes("@local")) {
      continue;
    }

    const dateStr = new Date().toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      timeZone: "Europe/Brussels",
    });

    const taskItems = tasks
      .slice(0, 12)
      .map((t) => {
        const time = t.due_time ? ` <span style="color:#94a3b8">${t.due_time}</span>` : "";
        const badge =
          t.priority === 1
            ? ` <span style="color:#f87171">P1</span>`
            : t.priority === 2
            ? ` <span style="color:#fb923c">P2</span>`
            : "";
        return `<li style="margin:4px 0">${esc(t.title)}${time}${badge}</li>`;
      })
      .join("");

    const more = total > 12 ? `<p style="color:#64748b;margin:8px 0">…and ${total - 12} more</p>` : "";

    const summary =
      total === 0
        ? "<p>Nothing due today - enjoy a clear day! 🎉</p>"
        : `<p style="margin:0 0 12px"><strong>${total} task${total !== 1 ? "s" : ""} today</strong>${
            overdue ? ` · <span style="color:#f87171">${overdue} overdue</span>` : ""
          }${urgent ? ` · ${urgent} urgent` : ""}</p><ul style="margin:0;padding-left:20px">${taskItems}</ul>${more}`;

    const html = `
<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
  <h2 style="margin:0 0 4px;font-size:18px">Good morning ☀</h2>
  <p style="color:#64748b;margin:0 0 20px;font-size:14px">${dateStr}</p>
  ${summary}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
  <p style="font-size:12px;color:#94a3b8">
    <a href="https://checkbox.tamara-sovcik.workers.dev" style="color:#6366f1">Open Checkbox</a>
  </p>
</div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Checkbox <onboarding@resend.dev>",
        to: [user.email],
        subject: `Checkbox · ${dateStr}${
          total > 0 ? ` - ${total} task${total !== 1 ? "s" : ""}` : " - clear day"
        }`,
        html,
      }),
    }).catch(console.error);
  }
}
