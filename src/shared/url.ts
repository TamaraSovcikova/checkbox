// Links that end up in an href: task permalinks, link attachments, mail
// permalinks. Several arrive from agents over MCP, so any of them could carry a
// `javascript:` or `data:` URL. React 19 refuses to render a javascript: href,
// but that is the last line; the stored value should never be one in the first
// place. Anything that is not plain http(s) becomes null.
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}
