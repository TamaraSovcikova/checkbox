// Gmail live sync for the coverage inbox (Phase B). Self-contained: it reuses
// only the GENERIC Google helpers from gcal.ts (AES crypto, code exchange, token
// refresh, userinfo) and keeps its OWN account row, token handling and error
// surfacing, so it never touches the calendar auth path.

import type { Bindings } from "../db";
import { uuid } from "../db";
import {
  encryptToken,
  decryptToken,
  exchangeCode,
  refreshAccessToken,
  getGoogleEmail,
} from "./gcal";
import { upsertMailCandidate } from "../routes/mail";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// gmail.modify: one restricted scope covering read now + draft/label/archive
// later. Send is never called (enforced by test/invariants.test.ts).
const GMAIL_SCOPES =
  "https://www.googleapis.com/auth/gmail.modify openid email profile";

export type GmailAccount = {
  id: string;
  user_id: string;
  google_email: string;
  refresh_token_enc: string;
  access_token: string | null;
  token_expiry: string | null;
  scopes: string | null;
  last_error: string | null;
  last_error_at: string | null;
  last_sync_at: string | null;
};

export function buildGmailAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  })}`;
}

export async function getGmailAccount(
  env: Bindings,
  userId: string
): Promise<GmailAccount | null> {
  return env.DB.prepare("SELECT * FROM gmail_accounts WHERE user_id = ? LIMIT 1")
    .bind(userId)
    .first<GmailAccount>();
}

export async function noteGmailError(
  env: Bindings,
  id: string,
  message: string
): Promise<void> {
  await env.DB.prepare(
    "UPDATE gmail_accounts SET last_error = ?, last_error_at = ? WHERE id = ?"
  )
    .bind(message.slice(0, 800), new Date().toISOString(), id)
    .run()
    .catch(() => {});
}

async function clearGmailError(env: Bindings, id: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE gmail_accounts SET last_error = NULL, last_error_at = NULL WHERE id = ?"
  )
    .bind(id)
    .run()
    .catch(() => {});
}

// Store (or refresh) the connection after OAuth. UNIQUE(user_id) → upsert.
export async function connectGmail(
  env: Bindings,
  userId: string,
  code: string,
  redirectUri: string
): Promise<void> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CALENDAR_ENCRYPTION_KEY) {
    throw new Error("Google not configured");
  }
  const tokens = await exchangeCode(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri,
    code
  );
  const email = await getGoogleEmail(tokens.access_token);
  const encRefresh = await encryptToken(
    env.CALENDAR_ENCRYPTION_KEY,
    tokens.refresh_token
  );
  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await env.DB.prepare(
    `INSERT INTO gmail_accounts
       (id, user_id, google_email, refresh_token_enc, access_token, token_expiry, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       google_email = excluded.google_email,
       refresh_token_enc = excluded.refresh_token_enc,
       access_token = excluded.access_token,
       token_expiry = excluded.token_expiry,
       scopes = excluded.scopes,
       last_error = NULL, last_error_at = NULL`
  )
    .bind(
      uuid(),
      userId,
      email,
      encRefresh,
      tokens.access_token,
      tokenExpiry,
      GMAIL_SCOPES
    )
    .run();
}

async function getValidGmailToken(
  env: Bindings,
  account: GmailAccount
): Promise<string> {
  if (account.access_token && account.token_expiry) {
    if (Date.now() < new Date(account.token_expiry).getTime() - 60_000) {
      return account.access_token;
    }
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.CALENDAR_ENCRYPTION_KEY) {
    throw new Error("Google not configured");
  }
  const refreshToken = await decryptToken(
    env.CALENDAR_ENCRYPTION_KEY,
    account.refresh_token_enc
  );
  let tokens;
  try {
    tokens = await refreshAccessToken(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      refreshToken
    );
  } catch (e) {
    // A revoked/expired refresh token breaks the pull; record it so the app can
    // ask for a reconnect instead of failing silently.
    await noteGmailError(env, account.id, String((e as Error).message));
    throw e;
  }
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await env.DB.prepare(
    "UPDATE gmail_accounts SET access_token = ?, token_expiry = ?, last_error = NULL, last_error_at = NULL WHERE id = ?"
  )
    .bind(tokens.access_token, expiry, account.id)
    .run();
  return tokens.access_token;
}

// ── Gmail API (metadata only; never message bodies) ───────────────────────────

type GmailMsgRef = { id: string; threadId: string };

async function listMessageRefs(
  token: string,
  q: string,
  maxResults: number
): Promise<GmailMsgRef[]> {
  const params = new URLSearchParams({ q, maxResults: String(maxResults) });
  const res = await fetch(`${GMAIL_BASE}/users/me/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gmail list: ${await res.text()}`);
  const data = await res.json<{ messages?: GmailMsgRef[] }>();
  return data.messages ?? [];
}

type GmailMeta = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

async function getMessageMeta(token: string, id: string): Promise<GmailMeta> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Subject");
  const res = await fetch(`${GMAIL_BASE}/users/me/messages/${id}?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gmail get: ${await res.text()}`);
  return res.json();
}

function header(meta: GmailMeta, name: string): string | null {
  return (
    meta.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

// Pull recent threads and record a `pending` coverage row per message. The
// upsert precedence means anything the planner or the user already filed/skipped
// (or locked) is left alone; only genuinely new mail surfaces as pending.
export async function syncGmail(
  env: Bindings,
  userId: string
): Promise<{ fetched: number; upserted: number }> {
  const account = await getGmailAccount(env, userId);
  if (!account) throw new Error("No Gmail connected");

  try {
    const token = await getValidGmailToken(env, account);
    // Fetch universe: last 7 days, excluding chats. Cap at 100 (design OQ1).
    const refs = await listMessageRefs(token, "newer_than:7d -in:chats", 100);
    let upserted = 0;
    for (const ref of refs) {
      const meta = await getMessageMeta(token, ref.id);
      const received = meta.internalDate
        ? new Date(Number(meta.internalDate)).toISOString()
        : null;
      await upsertMailCandidate(env.DB, userId, {
        source: "gmail_sync",
        thread_id: meta.threadId,
        message_id: meta.id,
        from_addr: header(meta, "From"),
        subject: header(meta, "Subject"),
        snippet: meta.snippet ?? null,
        received_at: received,
        permalink: `https://mail.google.com/mail/u/0/#all/${meta.threadId}`,
        verdict: "pending",
      });
      upserted++;
    }

    // Reconcile deletions: mail the user has since trashed in Gmail should leave
    // the coverage list. Pull recently-trashed messages and drop any still-
    // pending row for them. Rows a human has ruled on (filed/skipped, locked)
    // are a deliberate record and stay. Emptying the trash (permanent delete)
    // isn't covered: those messages no longer appear in any search.
    await removeTrashedPending(env, userId, token);

    await env.DB.prepare(
      "UPDATE gmail_accounts SET last_sync_at = ? WHERE id = ?"
    )
      .bind(new Date().toISOString(), account.id)
      .run();
    if (account.last_error) await clearGmailError(env, account.id);
    return { fetched: refs.length, upserted };
  } catch (e) {
    await noteGmailError(env, account.id, String((e as Error).message));
    throw e;
  }
}

// Drop still-pending coverage rows whose Gmail message the user has trashed, so
// deleting an email in Gmail removes it from the coverage list. Only `pending`,
// unlocked rows are touched (filed/skipped rows are a kept record). One extra
// search covers the trash; D1's 100-bind cap means chunked deletes.
async function removeTrashedPending(
  env: Bindings,
  userId: string,
  token: string
): Promise<number> {
  const trashed = await listMessageRefs(token, "in:trash newer_than:30d", 200);
  if (trashed.length === 0) return 0;
  return deletePendingByMessageId(
    env.DB,
    userId,
    trashed.map((t) => t.id)
  );
}

// Delete still-pending, unlocked coverage rows for the given message ids. Kept
// separate + exported so the "trashed mail leaves the list, ruled-on mail stays"
// contract is unit-testable without the Gmail API. Chunked under D1's bind cap.
export async function deletePendingByMessageId(
  db: D1Database,
  userId: string,
  messageIds: string[]
): Promise<number> {
  const ids = [...new Set(messageIds)];
  let removed = 0;
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const ph = chunk.map(() => "?").join(",");
    const res = await db
      .prepare(
        `DELETE FROM mail_candidates
         WHERE user_id = ? AND verdict = 'pending' AND user_locked = 0
           AND message_id IN (${ph})`
      )
      .bind(userId, ...chunk)
      .run();
    removed += res.meta?.changes ?? 0;
  }
  return removed;
}
