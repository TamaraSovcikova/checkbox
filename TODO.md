# Checkbox - TODO / blocked items

## Blocked on Tamara (interactive logins; do when convenient)

- [ ] **GitHub:** `gh auth login --hostname github.com --git-protocol https --web` as **TamaraSovcikova**
      (this Mac's gh is on the work account `tamvqa` - never use it). Then Claude switches account,
      creates private `TamaraSovcikova/checkbox`, pushes `main`.
- [ ] **Cloudflare:** `npx wrangler login`. Then Claude runs `wrangler d1 create checkbox` +
      `wrangler kv namespace create SESSIONS`, pastes ids into `wrangler.jsonc`, `migrate:remote`,
      and `wrangler deploy` (hello-world to a real URL).

## Deferred to deployment

- [ ] Real WebAuthn passkey auth + session in KV (currently a single-user shim selects the one
      user row). Passkey enrollment is interactive and most meaningful on the deployed domain.
- [ ] Resend email digest (Phase 4). Google Calendar OAuth (Phase 2). MCP server (Phase 3).

## Decided defaults to confirm later

- Timezone defaults to `Europe/Brussels` (Tamara moves to Brussels 2026-07-01). Could switch to
  device-clock if preferred.
