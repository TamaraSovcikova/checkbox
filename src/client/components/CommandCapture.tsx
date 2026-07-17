import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseCapture, previewChips } from "../lib/nlp";
import { useCreateTask, useProjects, useAreas } from "../lib/queries";
import { api } from "../lib/api";
import { useTaskUI } from "../lib/ui-context";
import { dueLabel } from "../lib/due";
import { todayStr } from "@/lib/utils";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import {
  AddIcon,
  SearchIcon,
  TodayIcon,
  UpcomingIcon,
  OverdueIcon,
  BacklogIcon,
  LogbookIcon,
  CalendarIcon,
  SettingsIcon,
} from "../lib/icons";

const NAV = [
  { to: "/today", label: "Today", icon: TodayIcon },
  { to: "/upcoming", label: "Upcoming", icon: UpcomingIcon },
  { to: "/overdue", label: "Overdue", icon: OverdueIcon },
  { to: "/backlog", label: "Backlog", icon: BacklogIcon },
  { to: "/logbook", label: "Logbook", icon: LogbookIcon },
  { to: "/calendar", label: "Calendar", icon: CalendarIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

// The one global capture surface. Opens with Cmd/Ctrl-K from anywhere; typed
// text is parsed as a task (NLP) and created on Enter, or filters the view-jump
// list below. Replaces the per-view autoFocus inputs stealing the cursor.
export function CommandCapture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const navigate = useNavigate();
  const create = useCreateTask();
  const { open: openTask } = useTaskUI();
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const categoryNames = useMemo(
    () => [...areas.map((a) => a.name), ...projects.map((p) => p.name)],
    [areas, projects]
  );

  // Debounced task search: only queries once ≥2 chars have settled for 200ms.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const { data: results = [] } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.searchTasks(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    // Touch clients have no Cmd-K; the mobile add button dispatches this instead.
    // The header search box dispatches `checkbox:search`, same palette, which
    // already searches whatever is typed, so the two entry points converge here.
    const onCapture = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("checkbox:capture", onCapture);
    window.addEventListener("checkbox:search", onCapture);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("checkbox:capture", onCapture);
      window.removeEventListener("checkbox:search", onCapture);
    };
  }, []);

  const parsed = useMemo(() => parseCapture(text, categoryNames), [text, categoryNames]);
  const chips = previewChips(parsed);

  function close() {
    setOpen(false);
    setText("");
  }

  function submitCreate() {
    const title = parsed.title.trim();
    if (!title) return;
    let project_id: string | null = null;
    let area_id: string | null = null;
    if (parsed.projectName) {
      const q = parsed.projectName.toLowerCase();
      const proj = projects.find((p) => p.name.toLowerCase() === q);
      if (proj) {
        project_id = proj.id;
        area_id = proj.area_id;
      } else {
        const area = areas.find((a) => a.name.toLowerCase() === q);
        if (area) area_id = area.id;
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
    });
    close();
  }

  const q = text.trim().toLowerCase();
  const navMatches = NAV.filter((n) => n.label.toLowerCase().includes(q));

  return (
    <CommandDialog
      open={open}
      shouldFilter={false}
      onOpenChange={(o) => (o ? setOpen(true) : close())}
    >
      <CommandInput
        value={text}
        onValueChange={setText}
        placeholder="Search tasks, add one, or jump to a view…"
      />
      <CommandList>
        {q ? (
          <CommandGroup heading="Create">
            <CommandItem value="__create__" onSelect={submitCreate}>
              <AddIcon className="h-4 w-4 text-primary" />
              <span className="flex-1 truncate">Add “{parsed.title || text}”</span>
              <span className="flex shrink-0 gap-1">
                {chips.map((c, i) => (
                  <span
                    key={i}
                    className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted"
                  >
                    {c.label}
                  </span>
                ))}
              </span>
            </CommandItem>
          </CommandGroup>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-subtle">
            Type to add a task, search existing tasks, or jump to a view.
          </p>
        )}
        {results.length > 0 && (
          <CommandGroup heading="Tasks">
            {results.map((t) => (
              <CommandItem
                key={t.id}
                value={`task:${t.id}`}
                onSelect={() => {
                  openTask(t);
                  close();
                }}
              >
                <SearchIcon className="h-4 w-4 text-muted" />
                <span className="flex-1 truncate">{t.title}</span>
                {t.due_date && (
                  <span className="shrink-0 text-[11px] text-primary" title={t.due_date}>
                    {dueLabel(t.due_date, todayStr())}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {navMatches.length > 0 && (
          <CommandGroup heading="Go to">
            {navMatches.map((n) => {
              const Icon = n.icon;
              return (
                <CommandItem
                  key={n.to}
                  value={`nav:${n.label}`}
                  onSelect={() => {
                    navigate(n.to);
                    close();
                  }}
                >
                  <Icon className="h-4 w-4 text-muted" />
                  {n.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
