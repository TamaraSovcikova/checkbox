// VAPID Web Push — data-less push (no RFC 8291 payload encryption).
// The service worker fetches /api/push/brief-data on receipt and builds the notification.
//
// Secrets required:
//   VAPID_PUBLIC_KEY  — base64url of uncompressed P-256 point (65 bytes, no padding)
//   VAPID_PRIVATE_KEY_JWK — JSON-stringified JWK of the P-256 EC private key
// Generate both with: node scripts/gen-vapid.mjs

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function vapidJwt(
  endpoint: string,
  _vapidPublicKey: string,
  vapidPrivateKeyJwk: string
): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const exp = Math.floor(Date.now() / 1000) + 86400;

  const enc = (s: string) =>
    b64url(new TextEncoder().encode(s));

  const header = enc(JSON.stringify({ alg: "ES256", typ: "JWT" }));
  const payload = enc(
    JSON.stringify({ aud, exp, sub: "mailto:tamara.sovcik@gmail.com" })
  );
  const sigInput = `${header}.${payload}`;

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(vapidPrivateKeyJwk),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(sigInput)
  );

  return `${sigInput}.${b64url(sig)}`;
}

export async function sendPush(
  subs: PushSub[],
  env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY_JWK?: string }
): Promise<void> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY_JWK) return;

  await Promise.allSettled(
    subs.map(async (sub) => {
      const jwt = await vapidJwt(
        sub.endpoint,
        env.VAPID_PUBLIC_KEY!,
        env.VAPID_PRIVATE_KEY_JWK!
      );
      await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
          TTL: "86400",
          "Content-Length": "0",
        },
      });
    })
  );
}
