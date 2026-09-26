// Today's Focus (#3), the pure rules. See migration 0039 for why it exists.

// Past this many, the block says so instead of refusing: a focus list of
// twelve is a to-do list again, but the user decides that, not the app.
export const FOCUS_SOFT_CAP = 5;

type Focusable = {
  id: string;
  focus_date?: string | null;
  focus_rank?: number | null;
  status?: string;
};

export const isFocusedOn = (t: Focusable, today: string): boolean =>
  t.focus_date === today;

// Today's focus, in rank order, open tasks only.
export function focusList<T extends Focusable>(tasks: T[], today: string): T[] {
  return tasks
    .filter((t) => isFocusedOn(t, today) && t.status !== "done")
    .sort((a, b) => (a.focus_rank ?? 0) - (b.focus_rank ?? 0));
}

// The order after toggling one task in or out: added at the end, removed
// wherever it was.
export function toggleFocus(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

// The order after dragging `id` to position `to` (0-based).
export function moveFocus(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  const i = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, i), id, ...rest.slice(i)];
}
