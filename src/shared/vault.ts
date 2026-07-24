// Obsidian vault sync, the pure half: parse a task line from a note, and
// render the minimal edit back into it. Shared by the Worker (MCP sync tools)
// and tests. The IMPURE half (reading and writing actual files) is Claude's
// job at sync time; the Worker never touches a filesystem.
//
// v1 scope, deliberately narrow:
//   - Synced fields: done-state (the checkbox) and due date (the Obsidian
//     Tasks `📅 YYYY-MM-DD` field). `#now` maps to planned-today on pull.
//   - Titles are NOT synced in either direction: the note's text belongs to
//     the vault, and rewriting prose is how sync corrupts notes.
//   - Rendering only ever flips the checkbox char and edits the 📅 token.
//     Everything else on the line is preserved byte for byte.

export interface VaultLine {
  checked: boolean;
  due_date: string | null; // from 📅 YYYY-MM-DD
  now: boolean; // #now tag present
  text: string; // the full line, trimmed of trailing whitespace only
}

const TASK_LINE_RE = /^(\s*[-*+]\s+\[)( |x|X)(\]\s+)(.*)$/;
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const NOW_RE = /(^|\s)#now(\s|$)/;

// Parse one line. Returns null when the line is not a task checkbox at all.
export function parseVaultLine(line: string): VaultLine | null {
  const m = line.match(TASK_LINE_RE);
  if (!m) return null;
  const rest = m[4];
  const due = rest.match(DUE_RE);
  return {
    checked: m[2].toLowerCase() === "x",
    due_date: due ? due[1] : null,
    now: NOW_RE.test(rest),
    text: line.replace(/\s+$/, ""),
  };
}

// Render the desired state into the original line, touching ONLY the checkbox
// char and the 📅 token. Returns null when the line is not a task line (the
// caller must then refuse to write anything).
export function renderVaultLine(
  originalLine: string,
  desired: { checked: boolean; due_date: string | null }
): string | null {
  const m = originalLine.match(TASK_LINE_RE);
  if (!m) return null;
  let rest = m[4];

  if (desired.due_date) {
    if (DUE_RE.test(rest)) {
      rest = rest.replace(DUE_RE, `📅 ${desired.due_date}`);
    } else {
      rest = `${rest.replace(/\s+$/, "")} 📅 ${desired.due_date}`;
    }
  } else if (DUE_RE.test(rest)) {
    // Due date cleared in Checkbox: drop the token (and any doubled space).
    rest = rest.replace(DUE_RE, "").replace(/\s{2,}/g, " ").replace(/\s+$/, "");
  }

  return `${m[1]}${desired.checked ? "x" : " "}${m[3]}${rest}`.replace(/\s+$/, "");
}

// The reconcile decision for one linked task at pull time. The 2x2:
//   vault line changed?  (incoming text != stored source_text)
//   checkbox dirty?      (Checkbox changed state since last sync)
// - changed + clean  -> vault is the fresh side: apply its state to the task
// - changed + dirty  -> CONFLICT: vault wins on done-state, Checkbox wins on
//                       dates, and the caller reports it rather than deciding
//                       silently
// - unchanged + dirty -> nothing to pull; the writeback path pushes
// - unchanged + clean -> in sync; refresh the stored line number only
export type PullDecision =
  | { kind: "apply_vault" }
  | { kind: "conflict" }
  | { kind: "writeback_pending" }
  | { kind: "in_sync" };

export function pullDecision(
  incomingText: string,
  storedText: string | null,
  vaultDirty: boolean
): PullDecision {
  const changed = storedText == null || incomingText.trim() !== storedText.trim();
  if (changed && !vaultDirty) return { kind: "apply_vault" };
  if (changed && vaultDirty) return { kind: "conflict" };
  if (!changed && vaultDirty) return { kind: "writeback_pending" };
  return { kind: "in_sync" };
}
