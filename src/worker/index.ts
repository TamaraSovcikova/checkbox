import { Hono } from "hono";
import type { Bindings } from "./db";
import { auth } from "./routes/auth";
import { prefs } from "./routes/prefs";
import { areas } from "./routes/areas";
import { projects } from "./routes/projects";
import { tasks } from "./routes/tasks";
import { labels } from "./routes/labels";
import { views } from "./routes/views";
import { calendar } from "./routes/calendar";
import { push } from "./routes/push";
import { triage } from "./routes/triage";
import { filters } from "./routes/filters";
import { stats } from "./routes/stats";
import { review } from "./routes/review";
import { templates } from "./routes/templates";
import { attachments } from "./routes/attachments";
import { plans } from "./routes/plans";
import { notes } from "./routes/notes";
import { mail } from "./routes/mail";
import { gmail } from "./routes/gmail";
import { pins } from "./routes/pins";
import { trackers } from "./routes/trackers";
import { mcp } from "./routes/mcp";
import { exportRoute } from "./routes/export";
import { syncCalendar, renewWatchChannel } from "./lib/sync";
import { sendMorningBrief } from "./lib/brief";
import { generateDayPlansForAll } from "./lib/planner";
import { emitTrackerTasks } from "./lib/trackers";
import { sendDueReminders } from "./lib/reminders";

const app = new Hono<{ Bindings: Bindings }>();

// --- API routes -----------------------------------------------------------
app.get("/api/health", (c) =>
  c.json({ ok: true, app: "checkbox", phase: 8, ts: new Date().toISOString() })
);

app.route("/api/auth", auth);
app.route("/api/prefs", prefs);
app.route("/api/areas", areas);
app.route("/api/projects", projects);
app.route("/api/tasks", tasks);
app.route("/api/labels", labels);
app.route("/api/views", views);
app.route("/api/calendar", calendar);
app.route("/api/push", push);
app.route("/api/triage", triage);
app.route("/api/saved-filters", filters);
app.route("/api/stats", stats);
app.route("/api/review", review);
app.route("/api/templates", templates);
app.route("/api/attachments", attachments);
app.route("/api/plans", plans);
app.route("/api/notes", notes);
app.route("/api/mail", mail);
app.route("/api/gmail", gmail);
app.route("/api/pins", pins);
app.route("/api/trackers", trackers);
app.route("/api/export", exportRoute);
app.route("/mcp", mcp);

// --- Static SPA fallback --------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  async scheduled(
    event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    const cron = event.cron; // "*/15 * * * *" or "0 6 * * *"

    if (cron === "0 6 * * *") {
      // Cadence trackers that have gone past their target become real tasks
      // FIRST, so a cadence that came due overnight is in today's list before
      // the plan is drafted and the brief announces it.
      //
      // Sequential rather than waitUntil'd in parallel with the planner: the
      // planner reads the task list, and a task that appears halfway through
      // would be a coin toss as to whether it was considered.
      ctx.waitUntil(
        (async () => {
          const { results } = await env.DB.prepare(
            "SELECT id FROM users"
          ).all<{ id: string }>();
          for (const { id } of results ?? []) {
            await emitTrackerTasks(env.DB, id).catch(console.error);
          }
        })()
          .catch(console.error)
          .then(() => generateDayPlansForAll(env))
          .then(() => sendMorningBrief(env))
          .catch(console.error)
      );
      return;
    }

    // Every 15 min: calendar sync + watch renewal + due-time reminders
    const { results } = await env.DB.prepare("SELECT id FROM users").all<{
      id: string;
    }>();
    for (const { id: userId } of results) {
      ctx.waitUntil(syncCalendar(env, userId).catch(console.error));
      ctx.waitUntil(renewWatchChannel(env, userId).catch(console.error));
      ctx.waitUntil(sendDueReminders(env, userId).then(() => {}).catch(console.error));
    }
  },
};
