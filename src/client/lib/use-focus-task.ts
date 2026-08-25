import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Task } from "../../shared/types";
import { inTodayView } from "./today";

// "Open it where it lives."
//
// The task sheet's Navigate button sends you to the page the task actually
// belongs to (its project, else its area, else the Backlog) with `?focus=<id>`.
// Landing there is only half the job: a project board can be three columns of
// twenty cards, so arriving at the top and leaving you to hunt for the task you
// just asked for would be a worse answer than the side panel you came from.
//
// So the row or card whose id matches scrolls itself into view and lights up for
// a couple of seconds. The param is consumed as soon as it has been honoured
// (replace, not push), so a reload or a Back does not re-flash a task you have
// already found, and the URL you might copy is the plain page.
//
// Returns a ref to put on whatever element should scroll and glow, plus `lit`
// for the ring class. Every renderer that can appear on a project or area page
// calls this, so Navigate behaves the same whichever view mode is showing.
export function useFocusTask(taskId: string) {
  const [params, setParams] = useSearchParams();
  const focused = params.get("focus") === taskId;
  const ref = useRef<HTMLDivElement | null>(null);
  const [lit, setLit] = useState(false);

  useEffect(() => {
    if (!focused) return;
    // block: "center" rather than the default: the task should land where the
    // eye already is, not flush against the top edge under a sticky header.
    ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    setLit(true);
    const next = new URLSearchParams(params);
    next.delete("focus");
    setParams(next, { replace: true });
    const t = setTimeout(() => setLit(false), 2200);
    return () => clearTimeout(t);
    // Only on the transition into focus: params is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  return { focusRef: ref, lit };
}

// The glow itself, in one place so a row and a card flash identically.
export const FOCUS_RING = "ring-2 ring-primary ring-offset-2 ring-offset-background";

// Where a task's own page is. A project is the most specific home it can have,
// then its area; an unfiled task lives in the Backlog, except that the Backlog
// query deliberately excludes anything planned for today (it is being worked,
// not waiting), so those go to Today instead. Sending you to a page that does
// not contain the task would be the one outcome worse than not offering this.
export function taskHomePath(task: Task, today: string): string {
  const q = `?focus=${task.id}`;
  if (task.project_id) return `/project/${task.project_id}${q}`;
  if (task.area_id) return `/area/${task.area_id}${q}`;
  if (inTodayView(task, today)) return `/today${q}`;
  return `/backlog${q}`;
}

// What the button should say it will open, so the destination is known before
// the click rather than after it.
export function taskHomeLabel(
  task: Task,
  projectName?: string,
  areaName?: string
): string {
  if (task.project_id) return projectName ?? "its project";
  if (task.area_id) return areaName ?? "its area";
  return "its list";
}
