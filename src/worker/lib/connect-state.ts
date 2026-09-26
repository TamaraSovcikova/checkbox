// OAuth "connect" flows (Google Calendar, Gmail): the state nonce and the
// failure page, shared so the two callbacks cannot drift apart.
//
// The state used to be the user's id, sent to Google and never checked on the
// way back. That let anyone who got a code for THEIR Google account send the
// owner to the callback and attach their calendar to the owner's Checkbox, so
// every timed task would sync into a calendar the attacker can read. The login
// flow (routes/auth.ts) already did this properly; this is the same pattern.
//
// A nonce is single-use, expires, and is bound to the user who started the flow
// AND to which flow it was, so a Gmail state cannot complete a calendar connect.

import type { Bindings } from "../db";

const STATE_TTL_SECONDS = 600;
const key = (state: string) => `connectstate:${state}`;

export type ConnectPurpose = "calendar" | "gmail";

export async function issueConnectState(
  env: Pick<Bindings, "SESSIONS">,
  userId: string,
  purpose: ConnectPurpose
): Promise<string> {
  const state = crypto.randomUUID();
  await env.SESSIONS.put(key(state), JSON.stringify({ userId, purpose }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return state;
}

// True only when the state exists, belongs to this user and this flow. Consumed
// either way, so a state can never be replayed.
export async function consumeConnectState(
  env: Pick<Bindings, "SESSIONS">,
  state: string | undefined,
  userId: string,
  purpose: ConnectPurpose
): Promise<boolean> {
  if (!state) return false;
  const raw = await env.SESSIONS.get(key(state));
  if (!raw) return false;
  await env.SESSIONS.delete(key(state));
  try {
    const v = JSON.parse(raw) as { userId?: string; purpose?: string };
    return v.userId === userId && v.purpose === purpose;
  } catch {
    return false;
  }
}

// The page shown when a connect fails. FIXED text only: the query string and
// exception messages never reach the HTML, because echoing `?error=` into the
// page is what let a crafted link run script inside the app. Details go to the
// Worker log instead.
export function connectFailedPage(what: string, backHref: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${what} not connected</title>
<p>${what} was not connected. <a href="${backHref}">Go back</a> and try again.</p>`;
}
