// #10: security headers. Worker responses carry them; a response that set a
// stricter policy of its own (file downloads) keeps it. The static app's copy
// lives in public/_headers and must never allow inline script.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { withSecurityHeaders, API_SECURITY_HEADERS } from "../src/worker/lib/headers";

describe("withSecurityHeaders", () => {
  it("adds the full set to an API response", () => {
    const res = withSecurityHeaders(new Response("{}", { headers: { "content-type": "application/json" } }));
    for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("keeps a response's own stricter CSP", () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "Content-Security-Policy": "sandbox; default-src 'none'" } })
    );
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("works on redirects, whose headers are otherwise immutable", () => {
    const res = withSecurityHeaders(Response.redirect("https://example.com/", 302));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("public/_headers", () => {
  const root = join(__dirname, "..");
  const headers = readFileSync(join(root, "public", "_headers"), "utf8");
  const csp = headers.match(/Content-Security-Policy: (.+)/)![1];

  it("allows scripts from the app only, and no framing", () => {
    expect(csp).toMatch(/script-src 'self';/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("index.html has no inline script for that policy to block", () => {
    const html = readFileSync(join(root, "index.html"), "utf8");
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
    expect(inline).toEqual([]);
  });
});
