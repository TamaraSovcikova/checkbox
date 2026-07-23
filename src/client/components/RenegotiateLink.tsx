import { PlanIcon } from "../lib/icons";
import { todayStr } from "../lib/utils";

// "Renegotiate my week": the antidote to a red wall of overdue tasks. Same
// pattern as "Ask Claude to plan" - a Claude chat under the user's own
// subscription, working through the Checkbox MCP connector - but pointed at
// the pile-up: re-scope honestly instead of letting guilt accumulate.
function prompt(today: string): string {
  return `Renegotiate my week in Checkbox (today is ${today}). My overdue list has piled up and I want a realistic plan, not guilt.

Work through the Checkbox MCP connector:
1. list_tasks: pull every OPEN task that is overdue (due_date before today) plus anything due in the next 7 days.
2. list_areas and list_projects: read each goal so you weigh what actually matters, not just what is loudest.
3. For EACH overdue task, decide one of:
   - keep today (truly urgent): update_task with planned_date ${today}
   - defer honestly: reschedule_task to a date I can believe, not tomorrow-by-default
   - break down: create_subtask for the first concrete step, then reschedule the parent
   - drop: say so and why, but do NOT delete without asking me
4. Keep the kept-today set small enough to actually finish (use time estimates where set).
5. Finish with a short plain-English summary: kept / deferred / broken down / proposed drops, one line each with the why.`;
}

export function RenegotiateLink({ count }: { count: number }) {
  if (count === 0) return null;
  const url = `https://claude.ai/new?q=${encodeURIComponent(prompt(todayStr()))}`;
  return (
    <div className="mb-4 flex items-center gap-2 px-1 text-xs text-subtle">
      <span>
        {count} overdue task{count === 1 ? "" : "s"}. Falling behind is information, not failure.
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
        title="Opens a Claude chat that re-scopes your overdue pile via the Checkbox connector"
      >
        <PlanIcon className="h-3.5 w-3.5" /> Renegotiate my week
      </a>
    </div>
  );
}
