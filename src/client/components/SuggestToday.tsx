import { useMemo, useState } from "react";
import type { Task } from "../../shared/types";
import { suggestForToday } from "../../shared/suggest";
import { useTasks, useUpdateTask } from "../lib/queries";
import { useToast } from "../lib/toast";
import { PRIORITY_VAR } from "../lib/colors";
import { PlanIcon, TodayIcon, ExternalLinkIcon } from "../lib/icons";
import { Button } from "./ui";
import { todayStr } from "@/lib/utils";

// The prompt behind "Ask Claude to plan". Runs in a Claude chat under the user's
// subscription (zero API cost), driving the Checkbox MCP. It is written to be
// self-sufficient: everything it needs comes from the Checkbox connector (the
// goals live on projects/areas, so no local-vault access is required), it is
// handed today's date so it can't get the day or timezone wrong, and it names
// the exact tool + field for "add to Today" (update_task with planned_date).
function claudePrompt(today: string): string {
  return (
    `Plan my day in Checkbox for ${today} (today). Be proactive: even if my ` +
    "Today list is empty or nothing looks urgent, still choose a solid set of " +
    "tasks for me to work on.\n\n" +
    "Do everything through the Checkbox MCP connector:\n" +
    "1. list_tasks: review ALL my open tasks across every area, project and the backlog.\n" +
    "2. list_projects and list_areas: read the `goal` on each. These tell you what " +
    "I'm actually working toward, so weigh goal-fit, not just the nearest deadline.\n" +
    "3. Optional: if you ALSO happen to have access to my Obsidian notes through a " +
    "connected file tool, you may skim `Personal/_Stats_/` for extra context, but " +
    "do not block on it or worry if you can't reach it. The project and area goals " +
    "above are enough on their own.\n" +
    "4. Choose roughly 5 to 10 tasks that make the best use of today.\n" +
    `5. For EACH chosen task, call update_task with { id, planned_date: "${today}" }. ` +
    "That planned_date is exactly what puts a task in my Today view. Do NOT change " +
    "due dates and do NOT create calendar time-blocks.\n" +
    "6. Finish with a short, plain-English list, one line per task, saying why you chose it."
  );
}

// Zero-cost "plan my day": a rule-based pass over ALL open tasks that surfaces
// the ones worth pulling into Today (approaching deadline or high priority), plus
// a deep-link to have Claude do the smarter version on the user's subscription.
// This is selection (what to work on); PlanMyDay is scheduling (when).
export function SuggestToday() {
  const { data: all = [] } = useTasks({});
  const update = useUpdateTask();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const today = todayStr();
  const suggestions = useMemo(() => suggestForToday(all, today), [all, today]);
  const claudeUrl = `https://claude.ai/new?q=${encodeURIComponent(claudePrompt(today))}`;

  function addOne(task: Task) {
    update.mutate({ id: task.id, body: { planned_date: today } });
    toast(`Added “${task.title}” to Today`);
  }

  async function addAll() {
    await Promise.all(
      suggestions.map((s) =>
        update.mutateAsync({ id: s.task.id, body: { planned_date: today } })
      )
    );
    toast(`Added ${suggestions.length} to Today`);
    setOpen(false);
  }

  const claudeLink = (
    <a
      href={claudeUrl}
      target="_blank"
      rel="noreferrer"
      title="Opens a Claude chat that plans your day via the Checkbox connector — runs on your subscription, no API cost"
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <PlanIcon className="h-4 w-4" /> Ask Claude to plan
      <ExternalLinkIcon className="h-3 w-3" />
    </a>
  );

  if (!open) {
    return (
      <div className="mb-4 flex max-w-2xl flex-wrap items-center gap-2">
        <Button
          variant="subtle"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setOpen(true)}
        >
          <TodayIcon className="h-4 w-4 text-primary" /> Suggest for today
        </Button>
        {claudeLink}
      </div>
    );
  }

  return (
    <div className="mb-4 max-w-2xl rounded-xl border border-border bg-surface/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TodayIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Suggested for today</span>
          {suggestions.length > 0 && (
            <span className="text-xs text-subtle">{suggestions.length}</span>
          )}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-subtle hover:text-foreground"
        >
          close
        </button>
      </div>

      {suggestions.length === 0 ? (
        <p className="text-sm text-subtle">
          Nothing left to pull in — every open task is already in Today, done, or
          waiting on something else. Try “Ask Claude to plan” for a goal-aware take.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {suggestions.map((s) => (
            <li
              key={s.task.id}
              className="flex items-center gap-3 rounded-md bg-surface px-3 py-2 text-sm"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: PRIORITY_VAR[s.task.priority] }}
              />
              <span className="flex-1 truncate text-foreground">{s.task.title}</span>
              <span className="shrink-0 text-[11px] text-subtle">{s.reason}</span>
              <button
                onClick={() => addOne(s.task)}
                className="shrink-0 text-xs text-primary hover:underline"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {suggestions.length > 0 && (
          <Button variant="primary" className="h-8 text-xs" onClick={addAll}>
            Add all {suggestions.length} to Today
          </Button>
        )}
        {claudeLink}
      </div>
      <p className="mt-2 text-[11px] text-subtle">
        “Ask Claude” opens a chat that reviews everything and weighs the goals on
        your areas and projects, then plans via your Checkbox connector — needs
        only that connector enabled. Runs on your subscription, no API cost.
      </p>
    </div>
  );
}
