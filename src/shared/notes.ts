// Deterministic task extraction from Obsidian-style markdown notes. Shared by the
// Worker (the scan_notes_for_tasks MCP tool + the paste endpoint) and the client
// (the manual paste box). High-precision only: unchecked `- [ ]` checkboxes and
// TODO/FIXME markers. The fuzzier "I should email X" commitment detection is left
// to Claude, which passes those in separately via the MCP tool.

export interface NoteCandidate {
  title: string;
  line: number; // 1-indexed line in the source note
  kind: "checkbox" | "todo";
  context: string; // the raw source line (trimmed), for a preview
}

// Turn inline markdown into plain text for a clean task title:
//   [label](url) -> label   ·   [[wikilink|alias]] -> alias   ·   **bold**/*em*/`code` stripped
function cleanTitle(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2") // [[link|alias]] -> alias
    .replace(/\[\[([^\]]+)\]\]/g, "$1") // [[link]] -> link
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [label](url) -> label
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(\*|_)(.*?)\1/g, "$2") // italic
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\s+/g, " ")
    .trim();
}

const CHECKBOX_RE = /^\s*[-*+]\s+\[ \]\s+(.+\S)\s*$/; // unchecked only
const TODO_RE = /^\s*(?:[-*+]\s+)?(?:TODO|FIXME)\b\s*[:\-]?\s+(.+\S)\s*$/i;

// Extract high-precision task candidates from a note's raw text.
export function extractNoteTasks(text: string): NoteCandidate[] {
  const out: NoteCandidate[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = line.match(CHECKBOX_RE);
    if (m) {
      const title = cleanTitle(m[1]);
      if (title) out.push({ title, line: i + 1, kind: "checkbox", context: line.trim() });
      continue;
    }
    m = line.match(TODO_RE);
    if (m) {
      const title = cleanTitle(m[1]);
      if (title) out.push({ title, line: i + 1, kind: "todo", context: line.trim() });
    }
  }
  return out;
}

// Stable dedupe key so the same note line is never offered twice (even across
// re-scans, and even after it's been accepted or rejected).
export function candidateKey(
  sourcePath: string | null | undefined,
  line: number | null | undefined,
  title: string
): string {
  return `${sourcePath ?? ""}:${line ?? ""}:${title.toLowerCase().trim()}`;
}
