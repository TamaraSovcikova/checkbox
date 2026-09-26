// Security headers on everything the Worker itself answers (/api/*, /mcp) (#10).
// The static app gets the same set from public/_headers.
//
// A response that already set its own policy keeps it: file downloads carry a
// stricter sandbox CSP (routes/attachments), and nothing here should loosen that.
export const API_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export function withSecurityHeaders(res: Response): Response {
  // Redirects and some fetched responses have immutable headers; copy first.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(API_SECURITY_HEADERS))
    if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}
