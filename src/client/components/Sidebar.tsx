import { useState, type ComponentType } from "react";
import { NavLink, useNavigate } from "react-router-dom";
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
import { cn } from "@/lib/utils";
import {
  TodayIcon,
  UpcomingIcon,
  OverdueIcon,
  BacklogIcon,
  LogbookIcon,
  CalendarIcon,
  SettingsIcon,
  LogOutIcon,
  AddIcon,
  LogoIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "../lib/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

type IconType = ComponentType<{ className?: string }>;
type NavDef = { to: string; label: string; icon: IconType };

// Regrouped: task filters live under "Tasks"; the calendar is its own tool under
// "Plan" (no longer a peer of "Overdue"). Settings is gone from the nav — it
// lives once, in the profile menu at the bottom.
const TASK_VIEWS: NavDef[] = [
  { to: "/today", label: "Today", icon: TodayIcon },
  { to: "/upcoming", label: "Upcoming", icon: UpcomingIcon },
  { to: "/overdue", label: "Overdue", icon: OverdueIcon },
  { to: "/backlog", label: "Backlog", icon: BacklogIcon },
  { to: "/logbook", label: "Logbook", icon: LogbookIcon },
];
const PLAN_VIEWS: NavDef[] = [{ to: "/calendar", label: "Calendar", icon: CalendarIcon }];
const ALL_VIEWS = [...TASK_VIEWS, ...PLAN_VIEWS];

// Wraps a sidebar node as a drop target for tasks being dragged.
type DropSpec = { id: string; data: Record<string, unknown> };

function useDrop(spec?: DropSpec) {
  const { setNodeRef, isOver } = useDroppable({
    id: spec?.id ?? "noop",
    disabled: !spec,
    data: spec?.data,
  });
  return { ref: spec ? setNodeRef : undefined, isOver: !!spec && isOver };
}

function dropForView(to: string): DropSpec | undefined {
  if (to === "/today") return { id: "view:today", data: { type: "view", view: "today" } };
  if (to === "/backlog")
    return { id: "view:backlog", data: { type: "view", view: "backlog" } };
  return undefined;
}

function NavItem({
  def,
  onHide,
}: {
  def: NavDef;
  onHide?: () => void;
}) {
  const Icon = def.icon;
  const { ref, isOver } = useDrop(dropForView(def.to));
  return (
    <div ref={ref} className="group flex items-center">
      <NavLink
        to={def.to}
        className={({ isActive }) =>
          cn(
            "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            isActive
              ? "bg-surface-2 text-foreground"
              : "text-muted hover:bg-surface-2/60 hover:text-foreground",
            isOver && "ring-1 ring-primary"
          )
        }
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{def.label}</span>
      </NavLink>
      {onHide && (
        <button
          title={`Hide ${def.label}`}
          aria-label={`Hide ${def.label}`}
          onClick={onHide}
          className="mr-1 hidden h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:text-foreground group-hover:grid"
        >
          ✕
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
          className="grid w-4 place-items-center text-subtle"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {projects.length ? (
            open ? (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="h-1 w-1 rounded-full bg-border" />
          )}
        </button>
        <NavLink
          ref={ref}
          to={`/area/${id}`}
          className={({ isActive }) =>
            cn(
              "flex-1 truncate rounded-md px-2 py-1 text-sm transition-colors",
              isActive
                ? "bg-surface-2 text-foreground"
                : "text-foreground/90 hover:bg-surface-2/60",
              isOver && "ring-1 ring-primary"
            )
          }
        >
          {name}
        </NavLink>
      </div>
      {open && (
        <div className="ml-5 border-l border-border pl-2">
          {projects.map((p) => (
            <ProjectItem key={p.id} to={`/project/${p.id}`} label={p.name} projectId={p.id} areaId={id} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectItem({
  to,
  label,
  projectId,
  areaId,
}: {
  to: string;
  label: string;
  projectId: string;
  areaId: string;
}) {
  const { ref, isOver } = useDrop({
    id: `project:${projectId}`,
    data: { type: "project", projectId, areaId },
  });
  return (
    <div ref={ref}>
      <NavLink
        to={to}
        className={({ isActive }) =>
          cn(
            "block truncate rounded-md px-2 py-1 text-sm transition-colors",
            isActive
              ? "bg-surface-2 text-foreground"
              : "text-muted hover:bg-surface-2/60 hover:text-foreground",
            isOver && "ring-1 ring-primary"
          )
        }
      >
        {label}
      </NavLink>
    </div>
  );
}

function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-subtle">
        {title}
      </span>
      {action}
    </div>
  );
}

// Account + Settings + Log out, collapsed into one profile menu at the bottom.
// Settings lives here and only here.
function ProfileCard() {
  const me = useMe();
  const navigate = useNavigate();
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
    <div className="mt-3 shrink-0 border-t border-border pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2">
            {me?.avatar ? (
              <img
                src={me.avatar}
                alt=""
                className="h-8 w-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="grid h-8 w-8 place-items-center rounded-full bg-surface-2 text-sm font-medium text-foreground">
                {initial}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-foreground">
                {me?.name ?? me?.email ?? "Signed in"}
              </div>
              {me?.name && (
                <div className="truncate text-[11px] text-subtle">{me.email}</div>
              )}
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[13.5rem]">
          <DropdownMenuItem onSelect={() => navigate("/settings")}>
            <SettingsIcon className="h-4 w-4" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (!busy) logout();
            }}
          >
            <LogOutIcon className="h-4 w-4" />
            {busy ? "Logging out…" : "Log out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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

  const hiddenViews = ALL_VIEWS.filter((s) => isHidden(s.to));
  const visible = (items: NavDef[]) => items.filter((s) => !isHidden(s.to));

  async function addArea() {
    const name = prompt("New area name");
    if (!name) return;
    await api.createArea({ name });
    qc.invalidateQueries({ queryKey: ["areas"] });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface/60 p-3">
      <div className="mb-3 flex items-center gap-2 px-1">
        <LogoIcon className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight text-foreground">Checkbox</span>
        {!online && (
          <span
            title={`Offline${pending > 0 ? ` · ${pending} queued` : ""}`}
            className="ml-auto rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
          >
            {pending > 0 ? `offline · ${pending}` : "offline"}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Tasks */}
        <SectionHeader
          title="Tasks"
          action={
            <button
              onClick={() => setManage((m) => !m)}
              title="Manage views"
              className="text-[11px] text-subtle hover:text-foreground"
            >
              {manage ? "done" : "edit"}
            </button>
          }
        />
        <nav className="space-y-0.5">
          {visible(TASK_VIEWS).map((s) => (
            <NavItem key={s.to} def={s} onHide={manage ? () => hide(s.to) : undefined} />
          ))}
        </nav>

        {/* Plan */}
        {visible(PLAN_VIEWS).length > 0 && (
          <>
            <div className="mt-5" />
            <SectionHeader title="Plan" />
            <nav className="space-y-0.5">
              {visible(PLAN_VIEWS).map((s) => (
                <NavItem key={s.to} def={s} onHide={manage ? () => hide(s.to) : undefined} />
              ))}
            </nav>
          </>
        )}

        {/* Hidden (manage mode) */}
        {manage && hiddenViews.length > 0 && (
          <div className="mt-2 rounded-md border border-border p-2">
            <div className="mb-1 px-1 text-[11px] uppercase tracking-wide text-subtle">
              Hidden
            </div>
            {hiddenViews.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.to}
                  onClick={() => show(s.to)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-subtle transition-colors hover:bg-surface-2/60 hover:text-foreground"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="text-[11px] text-primary">show</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Areas */}
        <div className="mt-5" />
        <SectionHeader
          title="Areas"
          action={
            <button
              onClick={addArea}
              title="New area"
              className="grid h-5 w-5 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <AddIcon className="h-3.5 w-3.5" />
            </button>
          }
        />
        <div className="space-y-0.5">
          {areas.map((a) => (
            <AreaNode key={a.id} id={a.id} name={a.name} />
          ))}
          {areas.length === 0 && (
            <p className="px-2 text-xs text-subtle">No areas yet. Click +</p>
          )}
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <>
            <div className="mt-5" />
            <SectionHeader title="Labels" />
            <div className="flex flex-wrap gap-1 px-1">
              {labels.map((l) => (
                <NavLink
                  key={l.id}
                  to={`/label/${encodeURIComponent(l.name)}`}
                  className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2/70 hover:text-foreground"
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
