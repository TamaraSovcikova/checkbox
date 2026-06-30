# Checkbox

Personal, Claude-native task manager. Areas + project-sprints, full-NLP quick capture, a
unified day-planner with 2-way Google Calendar sync, installable PWA, and an MCP server so
Claude can read/add/edit/complete tasks directly.

## Stack

React + Vite + Tailwind v4 (shadcn/ui in Phase 1) client, served by a Cloudflare Worker
(Hono) that also hosts the API, the MCP server, and Cron jobs. Data in Cloudflare D1
(SQLite). Auth via WebAuthn passkey. Push via Web Push (VAPID). Email digests via Resend.

## Run locally

```bash
npm install

# terminal 1: the Worker (API + D1) on :8787
npm run dev:worker

# terminal 2: the Vite client on :5173 (proxies /api to the Worker)
npm run dev
```

First-time Cloudflare setup (needs `wrangler login`):

```bash
wrangler d1 create checkbox          # paste database_id into wrangler.jsonc
wrangler kv namespace create SESSIONS # paste id into wrangler.jsonc
npm run migrate:local                # apply migrations to local D1
```

## More

- Claude Code orientation: `CLAUDE.md`
- Full spec + narrative docs: `OneDrive/.../Workspace/Projects/Checkbox/` (SPEC, PURPOSE,
  ARCHITECTURE, EVOLUTION, INTERVIEW, MISTAKES)
