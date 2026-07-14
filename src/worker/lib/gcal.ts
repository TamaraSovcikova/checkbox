// Google Calendar API v3 client for Cloudflare Workers.
// All networking is plain fetch — no googleapis SDK (incompatible with Workers).

import type { Task } from "../../shared/types";

export type GCalEvent = {
  id: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string;
  extendedProperties?: { private?: Record<string, string> };
  updated?: string;
};

export type GCalEventList = {
  items: GCalEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// calendar.events: read/write events on any calendar we know the id of (task
// push + pull). calendar.readonly: list the user's calendars (calendarList) so
// we can discover and mirror every calendar, not just primary.
const SCOPES =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly openid email profile";

// ── AES-GCM encryption for refresh tokens ────────────────────────────────────

async function importKey(keyHex: string): Promise<CryptoKey> {
  const raw = Uint8Array.from({ length: 32 }, (_, i) =>
    parseInt(keyHex.slice(i * 2, i * 2 + 2), 16)
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

const toB64 = (buf: Uint8Array) =>
  btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_");
const fromB64 = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0)
  );

export async function encryptToken(
  keyHex: string,
  plaintext: string
): Promise<string> {
  const key = await importKey(keyHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptToken(
  keyHex: string,
  encrypted: string
): Promise<string> {
  const key = await importKey(keyHex);
  const [ivB64, ctB64] = encrypted.split(":");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ctB64)
  );
  return new TextDecoder().decode(plain);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string
): string {
  return `${AUTH_URL}?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  })}`;
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  code: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function getGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to get userinfo");
  const data = await res.json<{ email: string }>();
  return data.email;
}

export async function getPrimaryCalendarId(
  accessToken: string
): Promise<string> {
  // The calendarList endpoint requires the broad `calendar`/`calendar.readonly`
  // scope, but we only request `calendar.events`. When that call is rejected,
  // fall back to the "primary" alias — every events API endpoint accepts it,
  // so we never actually need to resolve the concrete calendar id.
  const res = await fetch(`${GCAL_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return "primary";
  const data = await res.json<{
    items: { id: string; primary?: boolean }[];
  }>();
  return data.items.find((c) => c.primary)?.id ?? "primary";
}

// ── Calendar list ─────────────────────────────────────────────────────────────

export type GCalCalendar = {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
  accessRole?: string; // owner | writer | reader | freeBusyReader | none
  backgroundColor?: string;
};

// The user's calendar list. Requires the calendar.readonly scope; returns null
// when that scope hasn't been granted yet (so callers fall back to primary).
export async function listCalendars(
  accessToken: string
): Promise<GCalCalendar[] | null> {
  const res = await fetch(`${GCAL_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json<{ items?: GCalCalendar[] }>();
  return data.items ?? [];
}

// ── Event CRUD ────────────────────────────────────────────────────────────────

export async function listEvents(
  accessToken: string,
  calendarId: string,
  opts: {
    timeMin?: string;
    timeMax?: string;
    syncToken?: string;
    pageToken?: string;
  }
): Promise<GCalEventList> {
  const params = new URLSearchParams({
    maxResults: "2500",
    singleEvents: "true",
    orderBy: "startTime",
  });
  if (opts.timeMin) params.set("timeMin", opts.timeMin);
  if (opts.timeMax) params.set("timeMax", opts.timeMax);
  if (opts.syncToken) params.set("syncToken", opts.syncToken);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (res.status === 410) throw new Error("SYNC_TOKEN_INVALID");
  if (!res.ok) throw new Error(`listEvents: ${await res.text()}`);
  return res.json();
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  event: Partial<GCalEvent>
): Promise<GCalEvent> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );
  if (!res.ok) throw new Error(`createEvent: ${await res.text()}`);
  return res.json();
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Partial<GCalEvent>
): Promise<GCalEvent> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );
  if (!res.ok) throw new Error(`updateEvent: ${await res.text()}`);
  return res.json();
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`deleteEvent: ${await res.text()}`);
  }
}

export async function watchCalendar(
  accessToken: string,
  calendarId: string,
  channelId: string,
  webhookUrl: string
): Promise<{ id: string; expiration: string }> {
  const res = await fetch(
    `${GCAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events/watch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: webhookUrl,
      }),
    }
  );
  if (!res.ok) throw new Error(`watchCalendar: ${await res.text()}`);
  return res.json();
}

// ── Task ↔ GCal event conversion ──────────────────────────────────────────────

export const TASK_ID_PROP = "checkbox_task_id";

// opts gates what gets synced (user prefs): a time block becomes a timed event,
// a due date an all-day event, each only if its flag is on. Both default on.
export function taskToGCalEvent(
  task: Task,
  opts: { timeBlocks?: boolean; dueDates?: boolean } = {}
): Partial<GCalEvent> {
  const timeBlocks = opts.timeBlocks !== false;
  const dueDates = opts.dueDates !== false;
  const base: Partial<GCalEvent> = {
    summary: task.title,
    extendedProperties: { private: { [TASK_ID_PROP]: task.id } },
  };
  if (timeBlocks && task.scheduled_start && task.scheduled_end) {
    base.start = { dateTime: task.scheduled_start, timeZone: "Europe/Brussels" };
    base.end = { dateTime: task.scheduled_end, timeZone: "Europe/Brussels" };
  } else if (dueDates && task.due_date) {
    base.start = { date: task.due_date };
    base.end = { date: task.due_date };
  }
  return base;
}
