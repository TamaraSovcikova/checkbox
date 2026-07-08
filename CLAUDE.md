# Checkbox - operational CLAUDE.md

Personal task manager. This is the operational file that lives with the code. Narrative docs
(PURPOSE, ARCHITECTURE, EVOLUTION, INTERVIEW, MISTAKES, SPEC) live in the OneDrive vault at
`Workspace/Projects/Checkbox/`.

## Where things are

- Code: `~/projects_/checkbox` (this repo). Outside OneDrive by convention.
- Remote: `github.com/TamaraSovcikova/checkbox` (private). NEVER push to the `tamvqa` account.
- Docs: `OneDrive/.../Workspace/Projects/Checkbox/` (+ `SPEC.md`, `docs/SESSION_LOG.md`).

## Stack

- Client: React 19 + Vite 6 + Tailwind v4. dnd-kit for board + timeline drag. chrono-node for
  NLP capture. TanStack Query. IndexedDB offline mutation queue. vite-plugin-pwa (injectManifest).
- Server: Cloudflare Worker (Hono) at `src/worker/index.ts`. Serves `/api/*`, `/mcp`, and
  the built client (`dist/client`) as SPA fallback.
- Data: D1 (SQLite). Schema in `migrations/`. Never edit an applied migration; add a higher
  number. Use `ADD COLUMN IF NOT EXISTS` for idempotency.
- Auth: WebAuthn passkey, single-user (STUBBED — current shim selects/creates one user row in D1).
  Sessions in KV.
- Calendar: Google Calendar API, full 2-way. Incremental sync tokens + watch webhooks, Cron
  fallback. Checkbox-owned events tagged via `extendedProperties.private.checkbox_task_id`.
- Push: VAPID (RFC 8292) data-less push. Service worker wakes, fetches `/api/push/brief-data`.
  Morning brief cron at 06:00 Brussels (0 6 * * *). Resend email digest gated on RESEND_API_KEY.
- MCP: JSON-RPC 2.0 over HTTP at `/mcp`. Bearer token auth. 16 tools.

## Current state (2026-07-08)

**Phases 0-4 + Tier 1 + Tier 2 + the Tier 4 moat (ambient planner #30, note
extraction #31) are all live**, plus full activation (push, email, R2) and an
installable/auto-updating PWA. Deployed at https://checkbox.tamara-sovcik.workers.dev.

```
Health: GET /api/health → { ok: true, phase: 8 }
MCP:    /mcp → 18 tools, bearer auth (per-user tokens in mcp_tokens)
D1:     all migrations 0001-0009 applied local + remote
```

Migrations: 0001 init · 0002 cal-unique · 0003 push-unique · 0004 auth-multiuser ·
0005 recurrence · 0006 tier2 (snooze/time/deps/templates) · 0007 day_plans ·
0008 note_candidates · 0009 attachment_size.

## Wrangler secrets in production

| Secret | Purpose | Status |
|---|---|---|
| `MCP_AUTH_TOKEN` | Bearer token for /mcp (legacy; per-user tokens in `mcp_tokens`) | Set |
| `CALENDAR_ENCRYPTION_KEY` | AES-GCM key for GCal refresh tokens | Set |
| `GOOGLE_CLIENT_ID` | GCal OAuth | Set (2026-07-02) |
| `GOOGLE_CLIENT_SECRET` | GCal OAuth | Set (2026-07-02) |
| `VAPID_PUBLIC_KEY` | Web Push | Set (2026-07-08) |
| `VAPID_PRIVATE_KEY_JWK` | Web Push | Set (2026-07-08) |
| `RESEND_API_KEY` | Email digest | Set (2026-07-08) |

R2 bucket `checkbox-attachments` is live (binding `ATTACHMENTS`, enabled 2026-07-08).
File uploads are capped in-app at 5 GB total (see `FREE_TIER_STORAGE_CAP` in
`routes/attachments.ts`) so they never cross R2's 10 GB free tier. All prod secrets
are now set; remaining user-side steps are browser/UI only (enable push in Settings).

## Layout

```
src/worker/index.ts        Hono app, cron dispatcher, route registry
src/worker/routes/         tasks, areas, projects, labels, calendar, push, triage, mcp
src/worker/lib/            gcal, sync, push, brief, nlp
src/client/App.tsx         React router
src/client/pages.tsx       All page components (Today, Backlog, BacklogBody, SettingsPage, ...)
src/client/components/     Sidebar, TaskDrawer, QuickCapture, DayView, Board, ui.tsx
src/client/lib/            api.ts, queries.ts, offline.ts
src/client/sw.ts           Service worker (workbox-precaching + push handler)
src/shared/types.ts        Shared types (Worker + client)
migrations/                SQL migrations (0001 full schema, 0002 cal UNIQUE, 0003 push UNIQUE)
scripts/gen-vapid.mjs      One-time VAPID key generator (run once, set two wrangler secrets)
wrangler.jsonc             Real D1/KV IDs are set. database_id and kv_id are populated.
```

## Build commands

```sh
npm run typecheck    # tsc -b (no emit)
npm run build        # tsc -b && vite build
npm run deploy       # npm run build && wrangler deploy
npm run dev          # wrangler dev (local D1, port 8787)
```

## Git / GitHub

The repo-local `.git/config` has `http.https://github.com.extraheader` set with base64-encoded
TamaraSovcikova credentials. This bypasses the global `gh` credential helper (which defaults to
the `tamvqa` work account). The setting survives `git` invocations and account switches.

If the PAT expires:
```sh
TOKEN=$(gh auth token --user TamaraSovcikova)
B64=$(printf "TamaraSovcikova:%s" "$TOKEN" | base64)
git config --local http.https://github.com.extraheader "Authorization: Basic $B64"
```

## Pending activation steps

1. **Google Calendar**: set up Google Cloud Console project (see SESSION_LOG Chat #5 for steps),
   enable Google Calendar API, create OAuth 2.0 credentials with redirect URI
   `https://checkbox.tamara-sovcik.workers.dev/api/calendar/callback`, then:
   `wrangler secret put GOOGLE_CLIENT_ID && wrangler secret put GOOGLE_CLIENT_SECRET`

2. **Web Push**: generate keys once and set secrets:
   ```sh
   node scripts/gen-vapid.mjs
   wrangler secret put VAPID_PUBLIC_KEY
   wrangler secret put VAPID_PRIVATE_KEY_JWK
   ```
   Then visit /settings in the app and Enable Push Notifications.

3. **MCP in Claude Desktop**: add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
   ```json
   {
     "mcpServers": {
       "checkbox": {
         "url": "https://checkbox.tamara-sovcik.workers.dev/mcp",
         "headers": { "Authorization": "Bearer 6y06F6xDZsJXxi78Ri1Pxlq8u6CL8j2J" }
       }
     }
   }
   ```

4. **Email digest** (optional): `wrangler secret put RESEND_API_KEY` with a Resend API key.

## MCP auth (two clients, two transports)

`/mcp` accepts a bearer token two ways (resolved in `routes/mcp.ts` -> `mcpUser`
-> `db.resolveBearerUser`): per-user tokens in `mcp_tokens`, or the legacy
`MCP_AUTH_TOKEN` -> owner. The token can arrive as either:

- **`Authorization: Bearer <token>` header** — used by the LOCAL clients (standalone
  Claude Desktop app + Claude Code) via `claude_desktop_config.json`, which run a
  local `mcp-remote` bridge that injects the header.
- **`?token=<token>` query param** — used by CLOUD-brokered connectors (Cowork /
  claude.ai "Add custom connector"). Anthropic's cloud reaches the public worker
  URL directly (no local bridge), and that connector UI takes only a URL + OAuth,
  with no header field, so the token rides in the URL. Header wins if both present.

Cowork/claude.ai do NOT read `claude_desktop_config.json` (that is local-only). For
Cowork, register `https://checkbox.tamara-sovcik.workers.dev/mcp?token=<token>` as a
custom connector. Token-in-URL is fine for this single-user app but can appear in
logs; rotate via Settings > Integrations. The proper long-term hardening is OAuth
2.1 (the connector UI's OAuth fields; Cloudflare `workers-oauth-provider` +
`@cloudflare/mcp-agent` do the heavy lifting) — not yet implemented.

## Conventions

- Single-user app, but every owned row carries `user_id` (isolation pattern).
- Default timezone `Europe/Brussels`.
- Free-tier only. Cloudflare Workers + D1, no paid services.
- No em-dashes (this file, code comments, git messages). Commit without AI attribution.

## Known gaps / next features

- WebAuthn passkey auth (current shim is `getUserId()` that selects/creates user row in D1)
- Recurring tasks (schema + cron stub exist, generation logic not implemented)
- Custom saved filters (table exists, UI not built)
- Obsidian read-only awareness for triage context
- Phase 1 polish: reschedule date-picker in TaskDrawer, intra-column board sort, shadcn/ui swap
