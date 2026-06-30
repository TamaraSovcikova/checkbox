import { useParams } from "react-router-dom";
import type { Task } from "../shared/types";
import {
  useAreas,
  useProjects,
  useTasks,
  useView,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { QuickCapture } from "./components/QuickCapture";
import { ProjectBoard } from "./components/ProjectBoard";
import { TaskRow } from "./components/TaskRow";
import { api } from "./lib/api";
import { useQueryClient } from "@tanstack/react-query";

function Header({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

function TaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const { open } = useTaskUI();
  if (tasks.length === 0)
    return <p className="px-2 text-sm text-slate-600">{empty}</p>;
  return (
    <div className="max-w-2xl">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onOpen={open} />
      ))}
    </div>
  );
}

const VIEW_META: Record<string, { title: string; sub: string; empty: string }> = {
  today: { title: "Today", sub: "Due, scheduled, or overdue", empty: "Nothing due today." },
  upcoming: { title: "Upcoming", sub: "Coming up", empty: "Nothing upcoming." },
  overdue: { title: "Overdue", sub: "Past due", empty: "Nothing overdue. Nice." },
  backlog: { title: "Backlog", sub: "Unassigned - triage later", empty: "Backlog is empty." },
  logbook: { title: "Logbook", sub: "Completed", empty: "No completed tasks yet." },
};

export function ViewPage({ name }: { name: string }) {
  const { data: tasks = [] } = useView(name);
  const meta = VIEW_META[name];
  return (
    <div>
      <Header title={meta.title} sub={meta.sub} />
      {name !== "logbook" && (
        <div className="mb-4 max-w-2xl">
          <QuickCapture />
        </div>
      )}
      <TaskList tasks={tasks} empty={meta.empty} />
    </div>
  );
}

export function AreaPage() {
  const { id = "" } = useParams();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects(id);
  const { data: tasks = [] } = useTasks({ area_id: id });
  const qc = useQueryClient();
  const area = areas.find((a) => a.id === id);

  async function addProject() {
    const name = prompt("New project (sprint) name");
    if (!name) return;
    await api.createProject({ name, area_id: id });
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  return (
    <div>
      <Header title={area?.name ?? "Area"} sub="Area" />

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Projects
          </span>
          <button onClick={addProject} className="text-sm text-sky-400">
            + New project
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/project/${p.id}`}
              className="rounded-lg border border-slate-800 bg-slate-900 p-3 hover:border-slate-700"
            >
              <div className="font-medium">{p.name}</div>
              {p.goal && <div className="text-xs text-slate-500">{p.goal}</div>}
            </a>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-slate-600">No projects yet.</p>
          )}
        </div>
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Loose tasks
      </div>
      <div className="mb-3 max-w-2xl">
        <QuickCapture defaultAreaId={id} />
      </div>
      <TaskList tasks={tasks} empty="No loose tasks in this area." />
    </div>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const { open } = useTaskUI();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return <p className="text-slate-500">Loading project...</p>;
  return (
    <div>
      <Header title={project.name} sub={project.goal ?? "Project"} />
      <div className="mb-4 max-w-2xl">
        <QuickCapture defaultProjectId={project.id} defaultAreaId={project.area_id} />
      </div>
      <ProjectBoard project={project} onOpen={open} />
    </div>
  );
}

export function LabelPage() {
  const { name = "" } = useParams();
  const { data: tasks = [] } = useTasks({});
  const filtered = tasks.filter((t) =>
    (t.labels ?? []).some((l) => l.name === decodeURIComponent(name))
  );
  return (
    <div>
      <Header title={`@${decodeURIComponent(name)}`} sub="Label" />
      <TaskList tasks={filtered} empty="No tasks with this label." />
    </div>
  );
}
