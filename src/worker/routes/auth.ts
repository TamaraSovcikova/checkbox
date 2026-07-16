// Google OAuth login + session management (M1).
// Invite-scale multi-tenant: only allowlisted Google emails can create a session.
// Distinct from the calendar-connect OAuth flow (that lives in routes/calendar.ts
// and asks for calendar.events scope; this asks only for identity).

import { Hono } from "hono";
import {
  type Bindings,
  createSession,
  destroySession,
  devUser,
  getSession,
  getSessionId,
  sessionCookie,
  clearSessionCookie,
  uuid,
} from "../db";
import { exchangeCode } from "../lib/gcal";

export const auth = new Hono<{ Bindings: Bindings }>();

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const LOGIN_SCOPES = "openid email profile";
const STATE_TTL_SECONDS = 600;

const redirectUri = (env: Bindings) => `${env.WORKER_URL}/api/auth/google/callback`;
const isSecure = (env: Bindings) => env.WORKER_URL.startsWith("https");

type GoogleUserInfo = {
  id: string; // stable Google subject id
  email: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
};

async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${await res.text()}`);
  return res.json<GoogleUserInfo>();
}

function notInvitedPage(email: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Not invited</title>
<style>body{font:16px system-ui;max-width:32rem;margin:20vh auto;padding:0 1rem;color:#0f172a}
a{color:#4f46e5}</style></head><body>
<h1>Checkbox is invite-only</h1>
<p><strong>${email}</strong> isn't on the invite list, so there's no account for it.</p>
<p>If this is your address, ask the owner to add you. <a href="/api/auth/google">Try a different account</a>.</p>
</body></html>`;
}

// ── GET /api/auth/google: kick off the OAuth redirect ──────────────────────
auth.get("/google", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) {
    return c.text("Google OAuth not configured (GOOGLE_CLIENT_ID unset).", 503);
  }
  const state = uuid();
  await c.env.SESSIONS.put(`oauthstate:${state}`, "login", {
    expirationTtl: STATE_TTL_SECONDS,
  });
  const url = `${AUTH_URL}?${new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(c.env),
    response_type: "code",
    scope: LOGIN_SCOPES,
    access_type: "online",
    prompt: "select_account",
    state,
  })}`;
  return c.redirect(url);
});

// ── GET /api/auth/google/callback: exchange, allowlist, adopt, mint session ──
auth.get("/google/callback", async (c) => {
  const { code, state, error } = c.req.query();
  if (error) return c.text(`Google returned an error: ${error}`, 400);
  if (!code || !state) return c.text("Missing code or state.", 400);

  // Verify + consume the state nonce (CSRF protection for the redirect).
  const stored = await c.env.SESSIONS.get(`oauthstate:${state}`);
  if (!stored) return c.text("Invalid or expired login state. Start over.", 400);
  await c.env.SESSIONS.delete(`oauthstate:${state}`);

  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) {
    return c.text("Google OAuth not configured.", 503);
  }

  let info: GoogleUserInfo;
  try {
    const tokens = await exchangeCode(
      c.env.GOOGLE_CLIENT_ID,
      c.env.GOOGLE_CLIENT_SECRET,
      redirectUri(c.env),
      code
    );
    info = await fetchUserInfo(tokens.access_token);
  } catch (e) {
    console.error("login callback error:", e);
    return c.text("Login failed. Try again.", 502);
  }

  const email = info.email.toLowerCase();

  // Invite allowlist: enforced before any session is minted.
  const allowed = await c.env.DB.prepare(
    "SELECT email, note FROM allowed_emails WHERE lower(email) = ?"
  )
    .bind(email)
    .first<{ email: string; note: string | null }>();
  if (!allowed) return c.html(notInvitedPage(email), 403);

  const userId = await resolveOrCreateUser(c.env, info, allowed.note);

  const sid = await createSession(c.env, {
    userId,
    email,
    name: info.name,
    avatar: info.picture,
  });
  c.header("Set-Cookie", sessionCookie(sid, isSecure(c.env)));
  return c.redirect("/");
});

// Adopt the seeded owner row on first login; otherwise match by google_sub or
// email; otherwise create a fresh user. Always refresh identity fields.
async function resolveOrCreateUser(
  env: Bindings,
  info: GoogleUserInfo,
  note: string | null
): Promise<string> {
  const email = info.email.toLowerCase();

  let user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?")
    .bind(info.id)
    .first<{ id: string }>();

  if (!user) {
    user = await env.DB.prepare("SELECT id FROM users WHERE lower(email) = ?")
      .bind(email)
      .first<{ id: string }>();
  }

  // Owner's first login: adopt the pre-auth seed row so existing data isn't orphaned.
  if (!user && note === "owner") {
    user = await env.DB.prepare(
      "SELECT id FROM users WHERE email = 'tamara@local' AND google_sub IS NULL LIMIT 1"
    ).first<{ id: string }>();
  }

  if (!user) {
    const id = uuid();
    await env.DB.prepare(
      "INSERT INTO users (id, email, display_name, google_sub, avatar_url) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, email, info.name ?? null, info.id, info.picture ?? null)
      .run();
    return id;
  }

  await env.DB.prepare(
    "UPDATE users SET email = ?, display_name = ?, google_sub = ?, avatar_url = ? WHERE id = ?"
  )
    .bind(email, info.name ?? null, info.id, info.picture ?? null, user.id)
    .run();
  return user.id;
}

// ── GET /api/auth/me: current session (or 401) ──────────────────────────────
auth.get("/me", async (c) => {
  const session = await getSession(c);
  if (session) {
    return c.json({
      userId: session.userId,
      email: session.email,
      name: session.name ?? null,
      avatar: session.avatar ?? null,
    });
  }
  // Local dev: with the bypass on, report the first user so the app is usable
  // without a Google login. Never enabled in production.
  if (c.env.DEV_AUTH_BYPASS === "1") {
    await devUser(c.env); // guarantee a user row exists
    const row = await c.env.DB.prepare(
      "SELECT id, email, display_name, avatar_url FROM users ORDER BY created_at LIMIT 1"
    ).first<{
      id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
    }>();
    if (row)
      return c.json({
        userId: row.id,
        email: row.email,
        name: row.display_name,
        avatar: row.avatar_url,
      });
  }
  return c.json({ error: "unauthenticated" }, 401);
});

// ── POST /api/auth/logout: destroy the session ──────────────────────────────
auth.post("/logout", async (c) => {
  const sid = getSessionId(c);
  if (sid) await destroySession(c.env, sid);
  c.header("Set-Cookie", clearSessionCookie(isSecure(c.env)));
  return c.json({ ok: true });
});
