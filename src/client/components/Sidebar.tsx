import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import {
  useAreas,
  useLabels,
  useProjects,
  useOnlineStatus,
  useViewPrefs,
} from "../lib/queries";
import { api } from "../lib/api";
import { useMe } from "../lib/ui-context";
import { useQueryClient } from "@tanstack/react-query";
import { cx } from "./ui";

// Wraps a sidebar node as a drop target for tasks being dragged (M3).
type DropSpec = { id: string; data: Record<string, unknown> };

function useDrop(spec?: DropSpec) {
  const { setNodeRef, isOver } = useDroppable({
    id: spec?.id ?? "noop",
    disabled: !spec,
    data: spec?.data,
  });
  return { ref: spec ? setNodeRef : undefined, isOver: !!spec && isOver };
}

const SMART = [
  { to: "/today", label: "Today", icon: "☀" },
  { to: "/calendar", label: "Calendar", icon: "📅" },
  { to: "/upcoming", label: "Upcoming", icon: "→" },
  { to: "/overdue", label: "Overdue", icon: "⚠" },
  { to: "/backlog", label: "Backlog", icon: "📥" },
  { to: "/logbook", label: "Logbook", icon: "✓" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

function Item({
  to,
  label,
  icon,
  onHide,
  drop,
}: {
  to: string;
  label: string;
  icon?: string;
  onHide?: () => void;
  drop?: DropSpec;
}) {
  const { ref, isOver } = useDrop(drop);
  return (
    <div ref={ref} className="group flex items-center">
      <NavLink
        to={to}
        className={({ isActive }) =>
          cx(
            "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm",
            isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/60",
            isOver && "ring-1 ring-sky-500"
          )
        }
      >
        {icon && <span className="w-4 text-center text-xs">{icon}</span>}
        <span className="truncate">{label}</span>
      </NavLink>
      {onHide && (
        <button
          title={`Hide ${label}`}
          aria-label={`Hide ${label}`}
          onClick={onHide}
          className="mr-1 hidden h-6 w-6 shrink-0 place-items-center rounded text-slate-500 hover:text-slate-200 group-hover:grid"
        >
          ⊘
        </button>
      )}
    </div>
  );
}

function AreaNode({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { data: projects = [] } = useProjects(id);
  const { ref, isOver } = useDrop({ id: `area:${id}`, data: { type: "area", areaId: id } });
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
          ref={ref}
          to={`/area/${id}`}
          className={({ isActive }) =>
            cx(
              "flex-1 truncate rounded-md px-2 py-1 text-sm",
              isActive ? "bg-slate-800 text-white" : "text-slate-200 hover:bg-slate-800/60",
              isOver && "ring-1 ring-sky-500"
            )
          }
        >
          {name}
        </NavLink>
      </div>
      {open && (
        <div className="ml-5 border-l border-slate-800 pl-2">
          {projects.map((p) => (
            <Item
              key={p.id}
              to={`/project/${p.id}`}
              label={p.name}
              drop={{
                id: `project:${p.id}`,
                data: { type: "project", projectId: p.id, areaId: id },
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Account + quick controls, pinned to the bottom of the sidebar.
function ProfileCard() {
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const initial = (me?.name || me?.email || "?").trim().charAt(0).toUpperCase();

  async function logout() {
    setBusy(true);
    try {
      await api.logout();
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <div className="mt-3 shrink-0 border-t border-slate-800 pt-3">
      <div className="flex items-center gap-2 px-1">
        {me?.avatar ? (
          <img
            src={me.avatar}
            alt=""
            className="h-8 w-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-700 text-sm font-medium text-slate-200">
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-slate-200">
            {me?.name ?? me?.email ?? "Signed in"}
          </div>
          {me?.name && (
            <div className="truncate text-[11px] text-slate-500">{me.email}</div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1 px-1">
        <NavLink
          to="/settings"
          className="flex-1 rounded-md px-2 py-1 text-center text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
        >
          Settings
        </NavLink>
        <button
          onClick={logout}
          disabled={busy}
          className="flex-1 rounded-md px-2 py-1 text-center text-xs text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 disabled:opacity-50"
        >
          {busy ? "…" : "Log out"}
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const { data: areas = [] } = useAreas();
  const { data: labels = [] } = useLabels();
  const qc = useQueryClient();
  const { online, pending } = useOnlineStatus();
  const { hide, show, isHidden } = useViewPrefs();
  const [manage, setManage] = useState(false);

  const visible = SMART.filter((s) => !isHidden(s.to));
  const hidden = SMART.filter((s) => isHidden(s.to));

  async function addArea() {
    const name = prompt("New area name");
    if (!name) return;
    await api.createArea({ name });
    qc.invalidateQueries({ queryKey: ["areas"] });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-950/60 p-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-lg">☑</span>
        <span className="font-semibold tracking-tight">Checkbox</span>
        {!online && (
          <span
            title={`Offline${pending > 0 ? ` · ${pending} queued` : ""}`}
            className="ml-auto rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
          >
            {pending > 0 ? `offline · ${pending}` : "offline"}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">
            Views
          </span>
          <button
            onClick={() => setManage((m) => !m)}
            title="Manage views"
            className="text-slate-500 hover:text-slate-200"
          >
            {manage ? "done" : "edit"}
          </button>
        </div>
        <nav className="space-y-0.5">
          {visible.map((s) => (
            <Item
              key={s.to}
              {...s}
              onHide={manage ? () => hide(s.to) : undefined}
              drop={
                s.to === "/today"
                  ? { id: "view:today", data: { type: "view", view: "today" } }
                  : s.to === "/backlog"
                    ? { id: "view:backlog", data: { type: "view", view: "backlog" } }
                    : undefined
              }
            />
          ))}
        </nav>

        {manage && hidden.length > 0 && (
          <div className="mt-2 rounded-md border border-slate-800 p-2">
            <div className="mb-1 px-1 text-[11px] uppercase tracking-wide text-slate-600">
              Hidden
            </div>
            {hidden.map((s) => (
              <button
                key={s.to}
                onClick={() => show(s.to)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-slate-500 hover:bg-slate-800/60 hover:text-slate-200"
              >
                <span className="w-4 text-center text-xs">{s.icon}</span>
                <span className="flex-1 truncate">{s.label}</span>
                <span className="text-[11px] text-indigo-400">show</span>
              </button>
            ))}
          </div>
        )}

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
      </div>

      <ProfileCard />
    </aside>
  );
}
