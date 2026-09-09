import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "./lib/api";
import { useTaskUI } from "./lib/ui-context";
import { parseTaskCode } from "../shared/taskCode";

// /task/:ref — open the app on one task.
//
// The point of the whole exercise: an agent can now write a clickable link whose
// text is the task's TITLE, and following it lands on the task itself. Before
// this there was nowhere for such a link to go, which is why agents quoted uuids
// instead: the uuid was the only thing that identified a task at all.
//
// Takes either form. A uuid is what a tool emits; a code is what she types after
// reading "CB-142" in a reply, and both have to work or the code is decorative.
//
// Renders nothing itself: it opens the task's panel over whatever page it sends
// her to, so she lands somewhere she can act rather than on a dead-end detail
// screen. Today for a live task, its own list for anything else.
export function TaskLinkPage() {
  const { ref = "" } = useParams();
  const navigate = useNavigate();
  const { open } = useTaskUI();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const code = parseTaskCode(ref);
        const task =
          code != null
            ? await api.taskByCode(code)
            : // A full uuid resolves directly; a fragment (what an agent quotes)
              // goes through the prefix lookup, which refuses an ambiguous one
              // rather than opening whichever task came back first.
              ref.length === 36
              ? await api.getTask(ref)
              : await api.taskByRef(ref);
        if (!live) return;
        // replace, not push: Back should return to wherever she came from, not
        // to a route that would immediately re-open the panel.
        navigate("/today", { replace: true });
        open(task);
      } catch {
        if (live) setError(ref);
      }
    })();
    return () => {
      live = false;
    };
  }, [ref, navigate, open]);

  if (error)
    return (
      <div className="p-8">
        <h2 className="text-lg font-semibold text-foreground">No such task</h2>
        <p className="mt-2 max-w-prose text-sm text-muted">
          Nothing here matches <span className="text-foreground">{error}</span>. It may
          have been deleted, or the code may be from a different list.
        </p>
      </div>
    );
  return <p className="p-8 text-sm text-subtle">Opening…</p>;
}
