import { Hono } from "hono";
import { type Bindings, getUserId } from "../db";
import {
  buildGmailAuthUrl,
  connectGmail,
  getGmailAccount,
  syncGmail,
} from "../lib/gmail";
import {
  issueConnectState,
  consumeConnectState,
  connectFailedPage,
} from "../lib/connect-state";

export const gmail = new Hono<{ Bindings: Bindings }>();

function redirectUri(env: Bindings): string {
  return `${env.WORKER_URL}/api/gmail/callback`;
}

// A dead Gmail connection is either an expired/revoked token (fix: reconnect) or
// a missing scope on the consent screen (fix: add gmail.modify, then reconnect).
function classify(err: string | null) {
  if (!err) return { kind: null as null | string };
  if (/invalid_grant|expired or revoked|unauthorized|401|invalid_scope|insufficient/i.test(err))
    return { kind: "auth" };
  return { kind: "other" };
}

gmail.get("/status", async (c) => {
  const userId = await getUserId(c);
  const account = await getGmailAccount(c.env, userId);
  const { kind } = classify(account?.last_error ?? null);
  return c.json({
    connected: !!account,
    google_email: account?.google_email ?? null,
    sync_broken: !!account?.last_error,
    error_kind: kind,
    last_error: account?.last_error ?? null,
    last_error_at: account?.last_error_at ?? null,
    last_sync_at: account?.last_sync_at ?? null,
  });
});

gmail.get("/connect", async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: "Google not configured" }, 503);
  const userId = await getUserId(c);
  const state = await issueConnectState(c.env, userId, "gmail");
  return c.redirect(
    buildGmailAuthUrl(c.env.GOOGLE_CLIENT_ID, redirectUri(c.env), state)
  );
});

gmail.get("/callback", async (c) => {
  const code = c.req.query("code");
  const error = c.req.query("error");
  const failed = () => c.html(connectFailedPage("Gmail", "/settings"), 400);
  if (error || !code) {
    if (error) console.error("gmail connect declined:", error);
    return failed();
  }
  try {
    const userId = await getUserId(c);
    // Only a flow this user started, in this browser, may attach a mailbox.
    if (!(await consumeConnectState(c.env, c.req.query("state"), userId, "gmail"))) {
      console.error("gmail callback: state missing, expired or not this user's");
      return failed();
    }
    await connectGmail(c.env, userId, code, redirectUri(c.env));
    // Kick off the first pull in the background so coverage fills right away.
    c.executionCtx?.waitUntil(syncGmail(c.env, userId).catch(console.error));
  } catch (e) {
    console.error("gmail callback error:", e);
    return failed();
  }
  return c.redirect("/mail");
});

// Refresh from Gmail: the live pull behind the button on the Mail coverage view.
gmail.post("/refresh", async (c) => {
  const userId = await getUserId(c);
  const account = await getGmailAccount(c.env, userId);
  if (!account) return c.json({ error: "No Gmail connected" }, 400);
  try {
    const r = await syncGmail(c.env, userId);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ error: String((e as Error).message) }, 502);
  }
});

gmail.delete("/disconnect", async (c) => {
  const userId = await getUserId(c);
  await c.env.DB.prepare("DELETE FROM gmail_accounts WHERE user_id = ?")
    .bind(userId)
    .run();
  return c.json({ ok: true });
});
