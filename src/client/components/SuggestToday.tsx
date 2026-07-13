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
// subscription (zero API cost), driving the Checkbox MCP to set planned_date.
const CLAUDE_PROMPT =
  "Plan my day in Checkbox. Use the Checkbox MCP tools: call list_tasks to " +
  "review all my open tasks, then pick the ones I should realistically tackle " +
  "today based on priority, due dates and what fits in a day (roughly 3-6). " +
  "Add each chosen task to my Today view by setting planned_date to today via " +
  "update_task, then give me a one-line rationale for the selection.";

const CLAUDE_URL = `https://claude.ai/new?q=${encodeURIComponent(CLAUDE_PROMPT)}`;

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
      href={CLAUDE_URL}
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
          Nothing pressing outside Today right now — your deadlines and priorities
          are already surfaced.
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
        “Ask Claude” opens a chat that plans via your Checkbox connector — needs
        that connector enabled. Runs on your subscription, no API cost.
      </p>
    </div>
  );
}
