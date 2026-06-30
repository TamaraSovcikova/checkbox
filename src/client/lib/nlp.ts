import * as chrono from "chrono-node";
import { format } from "date-fns";
import type { CaptureParse, Priority } from "../../shared/types";

// Parse a quick-capture string like:
//   "Call dentist tomorrow 3pm p2 @call #Belgium"
// into structured fields, returning the cleaned title plus what was extracted.
export function parseCapture(input: string): CaptureParse {
  let text = input;

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

  // date/time via chrono
  let due_date: string | null = null;
  let due_time: string | null = null;
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  if (results.length) {
    const r = results[0];
    const d = r.start.date();
    due_date = format(d, "yyyy-MM-dd");
    if (r.start.isCertain("hour")) due_time = format(d, "HH:mm");
    text = (text.slice(0, r.index) + text.slice(r.index + r.text.length)).trim();
  }

  const title = text.replace(/\s{2,}/g, " ").trim();
  return { title, due_date, due_time, priority, labelNames, projectName };
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
  for (const l of p.labelNames) chips.push({ label: `@${l}`, kind: "label" });
  if (p.projectName) chips.push({ label: `#${p.projectName}`, kind: "project" });
  return chips;
}
