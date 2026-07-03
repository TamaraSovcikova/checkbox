import { useMemo, useState } from "react";
import { parseCapture, previewChips } from "../lib/nlp";
import { useCreateTask, useProjects } from "../lib/queries";
import { Input } from "./ui";

const CHIP_STYLE: Record<string, string> = {
  date: "bg-sky-500/20 text-sky-300",
  priority: "bg-orange-500/20 text-orange-300",
  label: "bg-violet-500/20 text-violet-300",
  project: "bg-emerald-500/20 text-emerald-300",
};

export function QuickCapture({
  defaultAreaId,
  defaultProjectId,
}: {
  defaultAreaId?: string | null;
  defaultProjectId?: string | null;
}) {
  const [text, setText] = useState("");
  const create = useCreateTask();
  const { data: projects = [] } = useProjects();

  const parsed = useMemo(() => parseCapture(text), [text]);
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
      area_id,
      project_id,
    });
    setText("");
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Add a task... e.g. Call landlord tomorrow 3pm p2 @call #Belgium"
      />
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {chips.map((ch, i) => (
            <span
              key={i}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_STYLE[ch.kind]}`}
            >
              {ch.label}
            </span>
          ))}
          <span className="text-[11px] text-slate-500 self-center">
            press Enter to add
          </span>
        </div>
      )}
    </div>
  );
}
