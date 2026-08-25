import { useEffect, useRef } from "react";
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
// So the row or card whose id matches lights up, and the page scrolls to it.
//
// The scroll finds its target through the DOM (`[data-task-id]`), not through a
// React ref, and retries until it appears. Two live failures taught that: the
// row does not exist yet when the route first renders (its tasks are still in
// flight), and you arrive by closing a MODAL sheet, which leaves the body
// scroll-locked for a beat afterwards, so an early scroll is silently dropped.
// A ref also assumes the component that READ the param is the one holding the
// element, which stops being true the moment a task can render in two places.
//
// `lit` is derived from the URL rather than held in state, so the ring cannot
// drift out of step with it: the param is cleared when the flash is over, and
// that single act ends the highlight everywhere.
export function useFocusTask(taskId: string) {
  const [params, setParams] = useSearchParams();
  const focused = params.get("focus") === taskId;
  // Once per arrival. Without this the effect would re-run on every unrelated
  // search-param change and re-scroll a page you had since scrolled away from.
  const done = useRef(false);

  useEffect(() => {
    if (!focused || done.current) return;
    done.current = true;

    let tries = 0;
    const find = () => {
      const el = document.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`);
      // block: "center" rather than the default: the task should land where the
      // eye already is, not flush against the top edge under a sticky header.
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      else if (tries++ < 20) setTimeout(find, 100);
    };
    const first = setTimeout(find, 60);

    // Clear the flash, and with it the param: replace, not push, so a Back does
    // not walk into a re-flash, and the URL you might copy is the plain page.
    const off = setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      next.delete("focus");
      setParams(next, { replace: true });
    }, 2200);

    return () => {
      clearTimeout(first);
      clearTimeout(off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, taskId]);

  return { lit: focused };
}

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

// The glow itself, in one place so a row and a card flash identically.
export const FOCUS_RING = "ring-2 ring-primary ring-offset-2 ring-offset-background";
