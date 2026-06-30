import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useAreas, useLabels, useProjects } from "../lib/queries";
import { api } from "../lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { cx } from "./ui";

const SMART = [
  { to: "/today", label: "Today", icon: "☀" },
  { to: "/upcoming", label: "Upcoming", icon: "📅" },
  { to: "/overdue", label: "Overdue", icon: "⚠" },
  { to: "/backlog", label: "Backlog", icon: "📥" },
  { to: "/logbook", label: "Logbook", icon: "✓" },
];

function Item({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon?: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60"
        )
      }
    >
      {icon && <span className="w-4 text-center text-xs">{icon}</span>}
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

function AreaNode({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { data: projects = [] } = useProjects(id);
  return (
    <div>
      <div className="flex items-center">
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-4 text-slate-500 text-xs"
        >
          {projects.length ? (open ? "▾" : "▸") : "·"}
        </button>
        <NavLink
          to={`/area/${id}`}
          className={({ isActive }) =>
            cx(
              "flex-1 truncate rounded-md px-2 py-1 text-sm",
              isActive ? "bg-slate-800 text-white" : "text-slate-200 hover:bg-slate-800/60"
            )
          }
        >
          {name}
        </NavLink>
      </div>
      {open && (
        <div className="ml-5 border-l border-slate-800 pl-2">
          {projects.map((p) => (
            <Item key={p.id} to={`/project/${p.id}`} label={p.name} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { data: areas = [] } = useAreas();
  const { data: labels = [] } = useLabels();
  const qc = useQueryClient();

  async function addArea() {
    const name = prompt("New area name");
    if (!name) return;
    await api.createArea({ name });
    qc.invalidateQueries({ queryKey: ["areas"] });
  }

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-slate-950/60 p-3 overflow-y-auto">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-lg">☑</span>
        <span className="font-semibold tracking-tight">Checkbox</span>
      </div>

      <nav className="space-y-0.5">
        {SMART.map((s) => (
          <Item key={s.to} {...s} />
        ))}
      </nav>

      <div className="mt-5 mb-1 flex items-center justify-between px-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          Areas
        </span>
        <button onClick={addArea} className="text-slate-500 hover:text-slate-200">
          +
        </button>
      </div>
      <div className="space-y-0.5">
        {areas.map((a) => (
          <AreaNode key={a.id} id={a.id} name={a.name} />
        ))}
        {areas.length === 0 && (
          <p className="px-2 text-xs text-slate-600">No areas yet. Click +</p>
        )}
      </div>

      {labels.length > 0 && (
        <>
          <div className="mt-5 mb-1 px-2 text-[11px] uppercase tracking-wide text-slate-500">
            Labels
          </div>
          <div className="flex flex-wrap gap-1 px-1">
            {labels.map((l) => (
              <NavLink
                key={l.id}
                to={`/label/${encodeURIComponent(l.name)}`}
                className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-violet-300 hover:bg-slate-700"
              >
                @{l.name}
              </NavLink>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
