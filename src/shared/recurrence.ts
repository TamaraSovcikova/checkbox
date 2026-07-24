// Pure recurrence maths shared by the Worker (roll a task forward on completion)
// and the client (build + preview a recurrence spec). Operates on plain
// YYYY-MM-DD strings so it is timezone-independent: a due date is a calendar
// day, not an instant.
//
// Spec grammar (stored in tasks.recurrence):
//   daily | weekdays | weekly | monthly | yearly
//   every:<N>:day | every:<N>:week | every:<N>:month | every:<N>:year
//   weekly:<mon,tue,...>            (specific weekdays)

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function parse(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parse(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function addMonths(date: string, n: number): string {
  const [y, m, d] = parse(date);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return fmt(ny, nm, nd);
}

function weekdayOf(date: string): number {
  const [y, m, d] = parse(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The next calendar day strictly after `from` matching the recurrence, or null
// when the spec is empty/unrecognised.
export function nextDueDate(
  spec: string | null | undefined,
  from: string
): string | null {
  if (!spec) return null;
  const [kind, ...rest] = spec.split(":");

  switch (kind) {
    case "daily":
      return addDays(from, 1);
    case "weekly":
      if (rest.length && rest[0]) return nextWeekdayMatch(from, rest[0].split(","));
      return addDays(from, 7);
    case "monthly":
      return addMonths(from, 1);
    case "yearly":
      return addMonths(from, 12);
    case "weekdays":
      return nextWeekdayMatch(from, ["mon", "tue", "wed", "thu", "fri"]);
    case "every": {
      const n = Math.max(1, Number(rest[0]) || 1);
      const unit = rest[1] ?? "day";
      if (unit === "day") return addDays(from, n);
      if (unit === "week") return addDays(from, n * 7);
      if (unit === "month") return addMonths(from, n);
      if (unit === "year") return addMonths(from, n * 12);
      return null;
    }
    default:
      return null;
  }
}

function nextWeekdayMatch(from: string, days: string[]): string {
  const wanted = new Set(
    days
      .map((d) =>
        WEEKDAYS.indexOf(d.slice(0, 3).toLowerCase() as (typeof WEEKDAYS)[number])
      )
      .filter((i) => i >= 0)
  );
  if (wanted.size === 0) return addDays(from, 7);
  let cur = from;
  for (let i = 0; i < 7; i++) {
    cur = addDays(cur, 1);
    if (wanted.has(weekdayOf(cur))) return cur;
  }
  return addDays(from, 7);
}

// Human-readable label for a spec (chips, drawer summary).
export function recurrenceLabel(spec: string | null | undefined): string | null {
  if (!spec) return null;
  const [kind, ...rest] = spec.split(":");
  switch (kind) {
    case "daily":
      return "Daily";
    case "weekdays":
      return "Every weekday";
    case "weekly":
      if (rest[0]) {
        const names = rest[0]
          .split(",")
          .map((d) => d.charAt(0).toUpperCase() + d.slice(1, 3));
        return `Weekly · ${names.join(", ")}`;
      }
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "yearly":
      return "Yearly";
    case "every": {
      const n = Number(rest[0]) || 1;
      const unit = rest[1] ?? "day";
      return `Every ${n} ${unit}${n > 1 ? "s" : ""}`;
    }
    default:
      return spec;
  }
}

// The preset options offered in the drawer picker.
export const RECURRENCE_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

// ── End conditions ───────────────────────────────────────────────────────────
// A recurrence can end: `until` is the last calendar day an occurrence may
// land on; `count` is occurrences REMAINING including the one being resolved.
// Completing (or skipping) the last occurrence finishes the series: the caller
// clears the recurrence fields so the task behaves like a plain task after.

export type RollDecision =
  | { kind: "roll"; due_date: string; recurrence_count: number | null }
  | { kind: "finish" };

export function rollDecision(
  next: string | null,
  until: string | null,
  count: number | null
): RollDecision {
  if (!next) return { kind: "finish" };
  if (until && next > until) return { kind: "finish" };
  if (count != null) {
    if (count <= 1) return { kind: "finish" };
    return { kind: "roll", due_date: next, recurrence_count: count - 1 };
  }
  return { kind: "roll", due_date: next, recurrence_count: null };
}
