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
import { mcp } from "./routes/mcp";
import { syncCalendar, renewWatchChannel } from "./lib/sync";
import { sendMorningBrief } from "./lib/brief";

const app = new Hono<{ Bindings: Bindings }>();

// --- API routes -----------------------------------------------------------
app.get("/api/health", (c) =>
  c.json({ ok: true, app: "checkbox", phase: 5, ts: new Date().toISOString() })
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
      // Morning brief: push notification + email digest
      ctx.waitUntil(sendMorningBrief(env).catch(console.error));
      return;
    }

    // Every 15 min: calendar sync + watch renewal
    const { results } = await env.DB.prepare("SELECT id FROM users").all<{
      id: string;
    }>();
    for (const { id: userId } of results) {
      ctx.waitUntil(syncCalendar(env, userId).catch(console.error));
      ctx.waitUntil(renewWatchChannel(env, userId).catch(console.error));
    }
  },
};
