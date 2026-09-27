// Escape text for HTML. The one copy: the server's HTML pages (morning brief
// email, the not-invited page) and the client's markdown renderer all use it.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
