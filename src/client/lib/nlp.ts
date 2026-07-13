import * as chrono from "chrono-node";
import { format, addDays } from "date-fns";
import type { CaptureParse, Priority } from "../../shared/types";
import { nextDueDate, recurrenceLabel } from "../../shared/recurrence";

const WEEKDAY_WORDS: Record<string, string> = {
  mon: "mon", monday: "mon",
  tue: "tue", tues: "tue", tuesday: "tue",
  wed: "wed", weds: "wed", wednesday: "wed",
  thu: "thu", thur: "thu", thurs: "thu", thursday: "thu",
  fri: "fri", friday: "fri",
  sat: "sat", saturday: "sat",
  sun: "sun", sunday: "sun",
};

// Extract a recurrence spec from a capture string, returning the spec (or null)
// and the text with the recurrence phrase removed. Runs before chrono so
// "every monday" isn't misread as a one-off date.
function extractRecurrence(text: string): { spec: string | null; rest: string } {
  // "every weekday(s)" / "on weekdays"
  let m = text.match(/\bevery\s+weekdays?\b/i) || text.match(/\bon\s+weekdays\b/i);
  if (m) return { spec: "weekdays", rest: text.replace(m[0], "") };

  // "daily" / "weekly" / "monthly" / "yearly" / "annually"
  m = text.match(/\b(daily|weekly|monthly|yearly|annually)\b/i);
  if (m) {
    const map: Record<string, string> = {
      daily: "daily", weekly: "weekly", monthly: "monthly",
      yearly: "yearly", annually: "yearly",
    };
    return { spec: map[m[1].toLowerCase()], rest: text.replace(m[0], "") };
  }

  // "every N days/weeks/months/years"
  m = text.match(/\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i);
  if (m) {
    return { spec: `every:${m[1]}:${m[2].toLowerCase()}`, rest: text.replace(m[0], "") };
  }

  // "every day/week/month/year"
  m = text.match(/\bevery\s+(day|week|month|year)\b/i);
  if (m) {
    const unit = m[1].toLowerCase();
    const spec = unit === "day" ? "daily" : unit === "week" ? "weekly" : unit === "month" ? "monthly" : "yearly";
    return { spec, rest: text.replace(m[0], "") };
  }

  // "every mon", "every mon,wed,fri", "every monday and thursday"
  m = text.match(/\bevery\s+([a-z, &]+?)(?=\s|$)/i);
  if (m) {
    const days = m[1]
      .split(/[,&]|\band\b/i)
      .map((d) => WEEKDAY_WORDS[d.trim().toLowerCase()])
      .filter(Boolean);
    if (days.length) {
      return { spec: `weekly:${[...new Set(days)].join(",")}`, rest: text.replace(m[0], "") };
    }
  }

  return { spec: null, rest: text };
}

// chrono in casual mode is eager: a bare time-of-day or vague temporal word
// mentioned in prose ("review the morning notes", "ask about this later") gets
// read as a due date. These words, matched ALONE, are not a date — they are
// almost always part of the title. Reject them, but keep every real phrase
// ("tomorrow", "next tue", "in 2 weeks", "on friday", "3pm", "jan 5").
const WEAK_DATE = new Set([
  "morning", "afternoon", "evening", "night", "nights", "noon", "midday",
  "midnight", "dawn", "dusk", "soon", "sometime", "some time", "someday",
  "some day", "later", "early", "earlier", "lately", "recently", "now",
]);

// The first chrono match that is actually a date, skipping weak-word matches.
function firstConfidentDate(text: string): chrono.ParsedResult | null {
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  for (const r of results) {
    if (!WEAK_DATE.has(r.text.trim().toLowerCase())) return r;
  }
  return null;
}

// Parse a quick-capture string like:
//   "Call dentist tomorrow 3pm p2 @call #Belgium"
// into structured fields, returning the cleaned title plus what was extracted.
export function parseCapture(input: string): CaptureParse {
  let text = input;

  // recurrence first, so "every monday" is not consumed by the date parser
  const rec = extractRecurrence(text);
  const recurrence = rec.spec;
  text = rec.rest;

  // priority: p1..p4 (word-boundary, case-insensitive)
  let priority: Priority | null = null;
  const pMatch = text.match(/\bp([1-4])\b/i);
  if (pMatch) {
    priority = Number(pMatch[1]) as Priority;
    text = text.replace(pMatch[0], "");
  }

  // labels: @label (letters, digits, dashes)
  const labelNames: string[] = [];
  text = text.replace(/@([\w-]+)/g, (_, n) => {
    labelNames.push(n);
    return "";
  });

  // project: #project (single token; quotes not supported in MVP)
  let projectName: string | null = null;
  const projMatch = text.match(/#([\w-]+)/);
  if (projMatch) {
    projectName = projMatch[1];
    text = text.replace(projMatch[0], "");
  }

  // date/time via chrono (weak, prose-y matches rejected)
  let due_date: string | null = null;
  let due_time: string | null = null;
  let dateText: string | null = null;
  // The title as it stands before the date is stripped — the fallback if the
  // user dismisses the detected date.
  const titleWithDate = text.replace(/\s{2,}/g, " ").trim();
  const r = firstConfidentDate(text);
  if (r) {
    const d = r.start.date();
    due_date = format(d, "yyyy-MM-dd");
    if (r.start.isCertain("hour")) due_time = format(d, "HH:mm");
    dateText = r.text;
    text = (text.slice(0, r.index) + text.slice(r.index + r.text.length)).trim();
  }

  // A recurring task needs a due-date anchor to roll forward from. If none was
  // given explicitly, anchor to the next occurrence starting today.
  if (recurrence && !due_date) {
    const yesterday = format(addDays(new Date(), -1), "yyyy-MM-dd");
    due_date = nextDueDate(recurrence, yesterday);
  }

  const title = text.replace(/\s{2,}/g, " ").trim();
  return {
    title,
    titleWithDate,
    due_date,
    due_time,
    dateText,
    priority,
    labelNames,
    projectName,
    recurrence,
  };
}

// Parse a free-text date phrase ("next tue", "tomorrow 3pm", "in 2 weeks") into
// a due date/time. Powers inline NLP date editing in the drawer (#11). Returns
// nulls when nothing date-like is found.
export function parseDatePhrase(
  input: string
): { due_date: string | null; due_time: string | null } {
  const r = firstConfidentDate(input);
  if (!r) return { due_date: null, due_time: null };
  const d = r.start.date();
  return {
    due_date: format(d, "yyyy-MM-dd"),
    due_time: r.start.isCertain("hour") ? format(d, "HH:mm") : null,
  };
}

// Build the chips shown live under the capture bar.
export function previewChips(p: CaptureParse): { label: string; kind: string }[] {
  const chips: { label: string; kind: string }[] = [];
  if (p.due_date)
    chips.push({
      label: p.due_time ? `${p.due_date} ${p.due_time}` : p.due_date,
      kind: "date",
    });
  if (p.priority) chips.push({ label: `P${p.priority}`, kind: "priority" });
  if (p.recurrence)
    chips.push({ label: recurrenceLabel(p.recurrence) ?? "repeats", kind: "recurrence" });
  for (const l of p.labelNames) chips.push({ label: `@${l}`, kind: "label" });
  if (p.projectName) chips.push({ label: `#${p.projectName}`, kind: "project" });
  return chips;
}
