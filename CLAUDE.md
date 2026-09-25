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
- MCP: JSON-RPC 2.0 over HTTP at `/mcp`. Bearer token auth. 46 tools (read + full
  write: task/area/project/subtask CRUD, dependencies, links, recurrence, batch
  create, saved filters, cadence trackers).

## Current state (2026-09-11)

**Phases 0-4 + Tier 1 + Tier 2 + the Tier 4 moat (ambient planner #30, note
extraction #31) are all live**, plus full activation (push, email, R2) and an
installable/auto-updating PWA. Deployed at https://checkbox.tamara-sovcik.workers.dev.

```
Health: GET /api/health → { ok: true, phase: 8 }
Version: GET /api/version → the deployed client bundle (deploy-freshness gate)
MCP:    /mcp → 46 tools, bearer auth (field AND feature parity are tested) (per-user tokens in mcp_tokens)
D1:     migrations 0001-0038 applied local + remote
```

Surfaces beyond the task views: `/home` (composable widget dashboard, layout in
UserPrefs.dashboard), `/flow` + a per-project Flow tab (dependency runway, see
shared/flow.ts), Cards, Cadences (sections via trackers.section + the prefs
registry), Calendar, Weekly review, Mail coverage.

`whenever` = "no deadline, ever" (hobby goals, articles to read). NOT a synonym
for priority 4 or `optional`: it marks a task that is undated ON PURPOSE, as
opposed to one not scheduled yet, which is the one thing nothing else could say.
Its own view `/whenever`, excluded from the Backlog, and the writers clear
due/planned dates when the flag goes on, since the two claims contradict.
`/whenever` splits into TWO TABS by `optional`: "Taking on" (actively picking it
up) and "Someday" (might never). whenever + optional together = bucket list; the
`commitment` grouping is the same split, available on any list.

Every task has a short code, `CB-<seq>`, shown on the sheet and returned by the
connector with a `/task/CB-142` deep link. `seq` is assigned by a database
trigger from a per-user high-water counter (migration 0038): never MAX+1, which
would hand a deleted task's code to the next one. Codes and uuid fragments (4+
hex) are accepted by search, the `/task/:ref` route and every connector tool that
takes a task id; an ambiguous fragment resolves to nothing, never to a guess.
The connector tells clients at connect time to name tasks by title-as-link plus
code and never quote a uuid.

Parked tasks (`parked_at` not null) leave EVERY list: the five views in
routes/views, the list endpoint, saved-filter defaults, and the connector's own
copies of the view SQL in routes/mcp. Reachable by id, search and `/parked`.

A task RENDERS as its due steps whenever it has one due or overdue
(`isSubtaskLed`), not only when the step is its sole claim on today. Two separate
questions: what CARRIES a task into Today stays strictly same-day, what a row
LOOKS like does not. The parent keeps its own complete circle on its own line.

Completing a task PLANS whatever it just unblocked, for today, and names them in
the toast (`worker/lib/unblock`). Derived from the completion rather than from
the blocker's due date, deliberately: a due date is a forecast, and a derived
date that silently goes stale is worse than no date. See SESSION_LOG chat #60
before changing this.

0/1 flag columns accept `1`, `true`, `"1"` or `"true"` on the wire and store 0/1
(`flagOn` / `normalizeFlags` in shared/dates). Never compare `=== 1` against a
value that came from a client: that exact mistake is in docs/MISTAKES.md twice.

test/mcp-coverage.test.ts pins the connector against the app TWICE: field by
field (add one to `WRITABLE` and it tells you to add it to `TASK_WRITABLE` and to
the tool schema, since a field the handler takes but the schema omits is one no
agent will ever pass), and FEATURE by feature (every `/api/*` route group needs a
tool or a stated reason not to). The second check exists because saved filters
went months with a rich query language and no way for the connector to see it.

The connector writes its OWN SQL for the list views, so a rule about what a view
shows has to be applied in routes/views AND in mcp.ts. That has leaked once
already (parked tasks stayed visible to agents after leaving every page), which
is why test/mcp-parked.test.ts pins the connector's behaviour separately. The
filter query language is the exception: routes/filters exports `runFilterQuery`
and the connector calls it, because two copies of THAT would be the worst place
in the codebase for a divergence.

Saved filters can ask about planned date, whenever, optional, recurring and
blocked as well as the older fields (routes/filters.ts, one shared clause builder
for both date columns). Bulk actions go through `bulkUpdate` in
TaskListControls, which snapshots per task for undo; the bar's Today/Tomorrow
set the PLANNED date, not a deadline.

Every date column is guarded THREE ways after the "null" incident (migration 0035
+ `shared/dates.ts` + `lib/safe-date.ts`): the MCP and REST writers normalise or
reject, D1 triggers ABORT a malformed write, and the client formatters return
null instead of throwing. A clearable date field in an MCP schema is typed
`["string","null"]`, never `"string"` with "or null" in the description: that gap
is what let the string "null" into ~50 rows and blanked the app. See
docs/MISTAKES.md before touching a date path.

Migration index: 0001-0031 as before (init, calendar, push, auth, recurrence,
tier2, day_plans, note_candidates, attachments, trackers, checkpoints, reminders,
vault sync) · 0032 projects.starred · 0033 trackers.section · 0034 task_links
(symmetric related-task links, both rows written per link) · 0035 date-shape
triggers on tasks/subtasks/projects · 0036 tasks.whenever · 0037
tasks.parked_at + park_reason · 0038 tasks.seq + the task_seq counter
(short codes).

A task carries TWO dates. `due_date` is when it is owed; `planned_date` is the day
you mean to work on it, it shifts freely, and it is what "Add to Today" writes
(planned_date = today). Today matches `planned_date <= today` so an unfinished
plan carries forward; Upcoming lists a FUTURE planned date only when the task has
no due date, so a task with both is listed once, on its deadline. Rows print a
`plan <day>` chip when the planned day is not today.

Four behaviours worth knowing before changing them: a recurring task COMPLETES and
the 06:00 sweep (worker/lib/resurrect) wakes the next occurrence next morning; a
subtask carries its parent into Today on its DUE DAY ONLY, a passed step moves the
parent to Overdue; a task in Today ONLY because of a due step RENDERS as that step
with the task as a breadcrumb (client/lib/today `isSubtaskLed`, used by TaskRow,
BoardCard and the Home widgets); and every path that finishes a task routes through
`lib/use-complete-guard`, which asks before completing one with open steps.

The task sheet is split Task / More by MEASURED usage, not by category (see
SESSION_LOG chat #58 for the rates). Rule when adding a field: above roughly
1-in-10 tasks it goes on Task, below it goes on More, and anything on More that
holds a value also shows as a chip on Task. Empty controls collapse to a dashed
chip rather than rendering their editor. Two fields sit against that rule on her
explicit instruction (#59): `optional` is a 2% field but lives on Task both ways,
because it is decided while looking at the task; the estimate is a 14% field but
lives on More, because it is a planning number, not a reading one.

The sheet's breadcrumb line also carries Complete (through `use-complete-guard`,
like every other completion path) and Navigate, which opens the task where it
lives and flashes it there (`lib/use-focus-task`, found by `data-task-id`, never
by a React ref: the row may not exist yet when the route first renders).

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
         "headers": { "Authorization": "Bearer <per-user token from Settings > Integrations>" }
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
- The repo is public. Tests, comments and commit messages use made-up examples, never
  real task titles, people's names or email addresses from the owner's data. Use
  `@example.com` / `.org` / `.net` addresses. Never paste a token or secret value into
  any file, including this one; refer to where it is set instead.
- Pre-commit guard: `.githooks/pre-commit` scans the lines a commit adds and blocks
  credential-shaped strings, email addresses outside the example domains, and any
  pattern listed in `.git/info/private-patterns` (local to each clone, never committed).
  Enable once per clone: `git config core.hooksPath .githooks`. A false positive can be
  committed with `git commit --no-verify` after checking the flagged line.

## Known gaps / next features

- WebAuthn passkey auth (current shim is `getUserId()` that selects/creates user row in D1)
- Recurring tasks (schema + cron stub exist, generation logic not implemented)
- Custom saved filters (table exists, UI not built)
- Obsidian read-only awareness for triage context
- Phase 1 polish: reschedule date-picker in TaskDrawer, intra-column board sort, shadcn/ui swap
