#!/usr/bin/env node
// One-time VAPID key generation.
// Run: node scripts/gen-vapid.mjs
// Then set the printed values as wrangler secrets.

import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;

const keyPair = await subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);

const privateJwk = await subtle.exportKey("jwk", keyPair.privateKey);
const publicJwk = await subtle.exportKey("jwk", keyPair.publicKey);

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Build uncompressed P-256 public key: 0x04 || x || y
const x = b64urlDecode(publicJwk.x);
const y = b64urlDecode(publicJwk.y);
const uncompressed = new Uint8Array(65);
uncompressed[0] = 0x04;
uncompressed.set(x, 1);
uncompressed.set(y, 33);

const publicKey = b64url(uncompressed);
const privateKeyJwk = JSON.stringify(privateJwk);

console.log("\n=== VAPID Keys ===\n");
console.log("Run these commands to set the secrets:\n");
console.log(`npx wrangler secret put VAPID_PUBLIC_KEY`);
console.log(`  > paste: ${publicKey}\n`);
console.log(`npx wrangler secret put VAPID_PRIVATE_KEY_JWK`);
console.log(`  > paste: ${privateKeyJwk}\n`);
console.log("Also add to .dev.vars for local development:");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY_JWK=${privateKeyJwk}`);
