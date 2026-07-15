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

// Index of the first `#` that starts a category token (string start or after
// whitespace), or -1. A bare `#` mid-word is left in the title.
function boundaryHashIndex(text: string): number {
  const m = text.match(/(^|\s)#/);
  return m ? m.index! + m[0].length - 1 : -1;
}

// Parse a quick-capture string like:
//   "Call dentist tomorrow 3pm p2 @call #Belgium"
// into structured fields, returning the cleaned title plus what was extracted.
//
// `knownCategories` are existing area + project names. When given, a `#` token
// is matched against the LONGEST known name it starts with, so multi-word
// categories ("#Health & Home", "#Trip Planning") resolve. Without a match (or
// an empty list) it falls back to a single `[\w-]+` token.
export function parseCapture(
  input: string,
  knownCategories: string[] = []
): CaptureParse {
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

  // category: #name — resolves to an area OR project. Match the longest known
  // multi-word name first (so "#Health & Home" works), else a single token.
  let projectName: string | null = null;
  const hashIdx = boundaryHashIndex(text);
  if (hashIdx >= 0) {
    const after = text.slice(hashIdx + 1);
    let matched: string | null = null;
    for (const name of knownCategories) {
      if (!name) continue;
      if (after.toLowerCase().startsWith(name.toLowerCase())) {
        const boundary = after[name.length];
        // The name must end at a word boundary, not mid-word ("#Care" must not
        // swallow the "er" of a "Career" title fragment).
        if (boundary === undefined || /[\s#@]/.test(boundary)) {
          if (!matched || name.length > matched.length) matched = name;
        }
      }
    }
    if (matched) {
      projectName = after.slice(0, matched.length); // preserve the typed casing
      text = text.slice(0, hashIdx) + after.slice(matched.length);
    } else {
      const single = after.match(/^([\w-]+)/);
      if (single) {
        projectName = single[1];
        text = text.slice(0, hashIdx) + after.slice(single[1].length);
      }
    }
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

// The `@label` or `#category` token the caret currently sits in, if any. Powers
// the type-ahead suggestions in QuickCapture.
//   - `@` tokens end at whitespace (labels are single words).
//   - `#` tokens run to the caret and may contain spaces (categories are often
//     multi-word), but close once the query exactly matches a known name and a
//     space has been typed after it — so the menu dismisses after a pick.
// `start` is the index of the trigger char; the query spans from there to the
// caret. Returns null when the caret is not in a token.
export function activeCaptureToken(
  text: string,
  caret: number,
  knownCategories: string[] = []
): { trigger: "@" | "#"; query: string; start: number } | null {
  const upto = text.slice(0, caret);

  const label = upto.match(/(?:^|\s)@([\w-]*)$/);
  if (label) return { trigger: "@", query: label[1], start: caret - label[1].length - 1 };

  const cat = upto.match(/(?:^|\s)#([^#@]*)$/);
  if (cat) {
    const query = cat[1];
    const settled =
      /\s$/.test(query) &&
      knownCategories.some((n) => n.toLowerCase() === query.trim().toLowerCase());
    if (settled) return null;
    return { trigger: "#", query, start: caret - query.length - 1 };
  }
  return null;
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
