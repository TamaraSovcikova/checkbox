import { Hono } from "hono";

type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// --- API routes -----------------------------------------------------------
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    app: "checkbox",
    phase: 0,
    ts: new Date().toISOString(),
  })
);

// Phase 1+ mounts /api/areas, /api/projects, /api/tasks, /api/views/* here.
// Phase 2+ mounts /api/calendar/*. Phase 3 mounts /mcp.

// --- Static SPA fallback --------------------------------------------------
// Anything not under /api is served from the built client (dist/client),
// with single-page-application not_found_handling (see wrangler.jsonc).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  // Cron entrypoint. Phase 2+: materialise recurring tasks, renew Google
  // Calendar watch channels + incremental sync. 06:00 trigger: send morning brief.
  async scheduled(
    _event: ScheduledController,
    _env: Bindings,
    _ctx: ExecutionContext
  ): Promise<void> {
    // no-op in Phase 0
  },
};
