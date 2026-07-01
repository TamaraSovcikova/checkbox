# Checkbox - TODO / blocked items

## Blocked on Tamara (interactive logins; do when convenient)

- [x] **GitHub:** TamaraSovcikova added via PAT (2026-07-01). Both accounts coexist in gh keyring.
      Repo created: https://github.com/TamaraSovcikova/checkbox (private). All 3 phases pushed.
      tamvqa stays active for work; gh credential helper auto-uses TamaraSovcikova for this repo.
- [ ] **Cloudflare:** `npx wrangler login`. Then Claude runs `wrangler d1 create checkbox` +
      `wrangler kv namespace create SESSIONS`, pastes ids into `wrangler.jsonc`, `migrate:remote`,
      and `wrangler deploy` (hello-world to a real URL).

## Deferred to deployment

- [ ] Real WebAuthn passkey auth + session in KV (currently a single-user shim selects the one
      user row). Passkey enrollment is interactive and most meaningful on the deployed domain.
- [ ] Google Calendar OAuth needs Google Cloud Console setup (see `.dev.vars.example`). Phase 2 backend is built — just needs credentials.
- [ ] MCP server built (Phase 3) — needs deployment to get a real URL before adding to Claude settings.
- [ ] Resend email digest (Phase 4).

## Decided defaults to confirm later

- Timezone defaults to `Europe/Brussels` (Tamara moves to Brussels 2026-07-01). Could switch to
  device-clock if preferred.
