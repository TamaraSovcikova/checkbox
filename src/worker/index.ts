import { Hono } from "hono";
import type { Bindings } from "./db";
import { areas } from "./routes/areas";
import { projects } from "./routes/projects";
import { tasks } from "./routes/tasks";
import { labels } from "./routes/labels";
import { views } from "./routes/views";
import { calendar } from "./routes/calendar";
import { mcp } from "./routes/mcp";
import { syncCalendar, renewWatchChannel } from "./lib/sync";

const app = new Hono<{ Bindings: Bindings }>();

// --- API routes -----------------------------------------------------------
app.get("/api/health", (c) =>
  c.json({ ok: true, app: "checkbox", phase: 2, ts: new Date().toISOString() })
);

app.route("/api/areas", areas);
app.route("/api/projects", projects);
app.route("/api/tasks", tasks);
app.route("/api/labels", labels);
app.route("/api/views", views);
app.route("/api/calendar", calendar);
app.route("/mcp", mcp);

// --- Static SPA fallback --------------------------------------------------
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,

  // Cron: */15 pulls events + renews watch channels; 06:00 reserved for morning brief (Phase 4).
  async scheduled(
    _event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    const { results } = await env.DB.prepare("SELECT id FROM users").all<{
      id: string;
    }>();
    for (const { id: userId } of results) {
      ctx.waitUntil(syncCalendar(env, userId).catch(console.error));
      ctx.waitUntil(renewWatchChannel(env, userId).catch(console.error));
    }
  },
};
