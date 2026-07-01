# Checkbox - TODO / blocked items

## Blocked on Tamara (interactive logins; do when convenient)

- [x] **GitHub:** TamaraSovcikova added via PAT (2026-07-01). Both accounts coexist in gh keyring.
      Repo created: https://github.com/TamaraSovcikova/checkbox (private). All 3 phases pushed.
      tamvqa stays active for work; gh credential helper auto-uses TamaraSovcikova for this repo.
- [x] **Cloudflare:** Done 2026-07-01. D1 `9fd24f30` (WEUR) + KV `9297e85a` created, both migrations
      applied, secrets set (MCP_AUTH_TOKEN, CALENDAR_ENCRYPTION_KEY). Live at
      https://checkbox.tamara-sovcik.workers.dev — health + MCP discovery both verified.

## Deferred to deployment

- [ ] Real WebAuthn passkey auth + session in KV (currently a single-user shim selects the one
      user row). Passkey enrollment is interactive and most meaningful on the deployed domain.
- [ ] Google Calendar OAuth needs Google Cloud Console setup (see `.dev.vars.example`). Phase 2 backend is built — just needs credentials.
- [ ] MCP server deployed at https://checkbox.tamara-sovcik.workers.dev/mcp — add to Claude settings:
      URL: https://checkbox.tamara-sovcik.workers.dev/mcp
      Header: Authorization: Bearer 6y06F6xDZsJXxi78Ri1Pxlq8u6CL8j2J
- [ ] Resend email digest (Phase 4).

## Decided defaults to confirm later

- Timezone defaults to `Europe/Brussels` (Tamara moves to Brussels 2026-07-01). Could switch to
  device-clock if preferred.
