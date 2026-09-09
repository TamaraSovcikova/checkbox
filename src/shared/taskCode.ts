// The short human name for a task: CB-142.
//
// It exists because a uuid cannot be said out loud or scanned for. When an agent
// discusses her tasks it quotes whatever identifier it was given, and a
// conversation full of 85cfb3fe-5de9-496f-aeb9-e7d2b4139634 is one she cannot
// follow up on without searching for a fragment of the title instead.
//
// The number is a per-user counter assigned by the database (migration 0038), so
// it is stable for the life of the task and survives an undo.

export const TASK_CODE_PREFIX = "CB";

export function taskCode(seq: number | null | undefined): string | null {
  return seq == null ? null : `${TASK_CODE_PREFIX}-${seq}`;
}

// Read a code back out of whatever she typed or said.
//
// Generous on purpose: "CB-142", "cb142", "#142" and a bare "142" all mean the
// same task, because this is meant to be typed into a search box mid-thought and
// pasted out of a chat reply, not entered into a form. Anything else is not a
// code, and a caller must treat that as "she meant a title" rather than guessing.
export function parseTaskCode(input: string | null | undefined): number | null {
  if (!input) return null;
  const m = String(input)
    .trim()
    .match(/^(?:#|cb[\s-]?)?(\d{1,9})$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Does this string look like a code rather than a title? Used where an argument
// accepts either, so "142" resolves to a task and "buy milk" searches.
export const looksLikeTaskCode = (input: string): boolean =>
  parseTaskCode(input) !== null;
