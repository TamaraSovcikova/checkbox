// Google Calendar push channels carry a token we can check (#11).
//
// The webhook used to trust any caller who knew a channel id. Google sends back
// whatever `token` the channel was created with in X-Goog-Channel-Token, so the
// token is an HMAC of the channel id under a secret the Worker already has
// (CALENDAR_ENCRYPTION_KEY): nothing new to store, and nothing to guess.
//
// Channel ids made this way start with CHANNEL_PREFIX. Older channels (plain
// uuids, no token) are renewed on the next cron tick and ignored until then;
// the 15-minute sync covers the gap.

export const CHANNEL_PREFIX = "cb2-";

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function channelTokenFor(secret: string, channelId: string): Promise<string> {
  return hmac(secret, `gcal-channel:${channelId}`);
}

export async function channelTokenValid(
  secret: string | undefined,
  channelId: string,
  token: string | null | undefined
): Promise<boolean> {
  if (!secret || !token || !channelId.startsWith(CHANNEL_PREFIX)) return false;
  const expected = await channelTokenFor(secret, channelId);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
