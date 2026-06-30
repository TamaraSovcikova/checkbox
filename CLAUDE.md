# Checkbox - operational CLAUDE.md

Personal task manager. This is the operational file that lives with the code. Narrative docs
(PURPOSE, ARCHITECTURE, EVOLUTION, INTERVIEW, MISTAKES, SPEC) live in the OneDrive vault at
`Workspace/Projects/Checkbox/`.

## Where things are

- Code: `~/projects_/checkbox` (this repo). Outside OneDrive by convention.
- Remote: `github.com/TamaraSovcikova/checkbox` (private). NEVER push to the `tamvqa` account.
- Docs: `OneDrive/.../Workspace/Projects/Checkbox/` (+ `SPEC.md`, `docs/SESSION_LOG.md`).

## Stack

- Client: React 19 + Vite 6 + Tailwind v4. shadcn/ui added in Phase 1. dnd-kit for board +
  timeline drag. chrono-node for NLP capture. TanStack Query (persisted to IndexedDB).
- Server: Cloudflare Worker (Hono) at `src/worker/index.ts`. Serves API (`/api/*`), MCP
  (`/mcp`, Phase 3), and the built client (`dist/client`) as SPA fallback.
- Data: D1 (SQLite). Schema in `migrations/`. Never edit an applied migration; add a higher
  number. Use `ADD/DROP COLUMN IF [NOT] EXISTS` for idempotency.
- Auth: WebAuthn passkey, single-user. Sessions in KV.
- Calendar: Google Calendar API, full 2-way. Incremental sync tokens + watch webhooks, Cron
  fallback. Checkbox-owned events tagged via `extendedProperties.private.checkbox_task_id`.

## Layout

```
src/worker/index.ts   Hono app: /api/health (Phase 0). API/MCP/Cron added per phase.
src/client/           React app (main.tsx, App.tsx).
migrations/0001_init.sql   Full schema.
wrangler.jsonc        Worker + assets + D1 + KV + cron. database_id/kv id are PLACEHOLDERs
                      until `wrangler d1 create` / `wrangler kv namespace create` are run.
```

## Conventions (project-specific)

- Single-user app, but every owned row carries `user_id` (per-user-isolation pattern).
- Default timezone `Europe/Brussels`.
- Free-tier only. Cloudflare Workers + D1, Resend free, no paid services.
- Commit style + no-AI-attribution + no em-dashes: see `~/devhub/conventions.md`.

## Build phases

0. Scaffold + auth + deploy hello-world (current).
1. MVP: Areas/Projects/Tasks CRUD, NLP capture, Today/Upcoming/Overdue/Backlog, PWA.
2. Calendar: OAuth, day-view timeline + drag-to-schedule, 2-way sync, recurring.
3. Claude: MCP server (full toolset), triage, plan-my-day, brief, weekly review.
4. Polish: push + morning brief + email digest, offline queue, filters, Obsidian read-only.
