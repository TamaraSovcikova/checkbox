import { useMemo, useState } from "react";
import { parseCapture, previewChips } from "../lib/nlp";
import type { CaptureParse } from "../../shared/types";
import { useCreateTask, useProjects } from "../lib/queries";
import { Input } from "./ui";

const CHIP_STYLE: Record<string, string> = {
  date: "bg-surface-2 text-muted",
  priority: "bg-surface-2 text-muted",
  recurrence: "bg-surface-2 text-muted",
  label: "bg-surface-2 text-muted",
  project: "bg-surface-2 text-muted",
};

// Apply a dismissed date: drop the due date and put the matched words back in
// the title, so nothing the user typed is lost.
function withDateDismissed(p: CaptureParse): CaptureParse {
  return { ...p, title: p.titleWithDate, due_date: null, due_time: null, dateText: null };
}

export function QuickCapture({
  defaultAreaId,
  defaultProjectId,
  defaultPlannedDate,
}: {
  defaultAreaId?: string | null;
  defaultProjectId?: string | null;
  // Capturing while on Today should land the task in Today, not silently in the
  // Backlog. planned_date does that without inventing a due date.
  defaultPlannedDate?: string | null;
}) {
  const [text, setText] = useState("");
  const [dateDismissed, setDateDismissed] = useState(false);
  const create = useCreateTask();
  const { data: projects = [] } = useProjects();

  const raw = useMemo(() => parseCapture(text), [text]);
  const parsed = dateDismissed ? withDateDismissed(raw) : raw;
  const chips = previewChips(parsed);

  function submit() {
    const title = parsed.title.trim();
    if (!title) return;

    // resolve #project to an existing project by name
    let project_id = defaultProjectId ?? null;
    let area_id = defaultAreaId ?? null;
    if (parsed.projectName) {
      const match = projects.find(
        (p) => p.name.toLowerCase() === parsed.projectName!.toLowerCase()
      );
      if (match) {
        project_id = match.id;
        area_id = match.area_id;
      }
    }

    create.mutate({
      title,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      priority: parsed.priority ?? 4,
      labelNames: parsed.labelNames,
      recurrence: parsed.recurrence,
      area_id,
      project_id,
      planned_date: defaultPlannedDate ?? null,
    });
    setText("");
    setDateDismissed(false);
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDateDismissed(false); // a new keystroke is a fresh parse + decision
        }}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a task... e.g. Call landlord tomorrow 3pm p2 @call #Belgium"
      />
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {chips.map((ch, i) =>
            // The date chip is removable — one click drops a wrong guess and
            // returns the words to the title.
            ch.kind === "date" ? (
              <button
                key={i}
                type="button"
                onClick={() => setDateDismissed(true)}
                title="Not a date? Click to remove"
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_STYLE[ch.kind]} hover:text-danger`}
              >
                {ch.label}
                <span aria-hidden>×</span>
              </button>
            ) : (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_STYLE[ch.kind]}`}
              >
                {ch.label}
              </span>
            )
          )}
          <span className="self-center text-[11px] text-subtle">
            press Enter to add
          </span>
        </div>
      )}
    </div>
  );
}
