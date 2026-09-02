import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ComponentType,
} from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useDroppable } from "@dnd-kit/core";
import type { Area, Label } from "../../shared/types";
import {
  useAreas,
  useLabels,
  useProjects,
  useOnlineStatus,
  useViewPrefs,
  useSavedFilters,
  useView,
} from "../lib/queries";
import { FilterDialog } from "./FilterDialog";
import { AreaDialog } from "./AreaDialog";
import { TemplatesSection } from "./TemplatesSection";
import { SearchBox } from "./SearchBox";
import { useMe } from "../lib/ui-context";
import { cn } from "@/lib/utils";
import { areaColorVar } from "../lib/colors";
import {
  TodayIcon,
  UpcomingIcon,
  OverdueIcon,
  BacklogIcon,
  WheneverIcon,
  LogbookIcon,
  CalendarIcon,
  FlowIcon,
  HomeIcon,
  MailIcon,
  PinsIcon,
  CadenceIcon,
  SettingsIcon,
  LogOutIcon,
  AddIcon,
  LogoIcon,
  FilterIcon,
  ReviewIcon,
  SnoozeIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  areaIcon,
} from "../lib/icons";
import { api } from "../lib/api";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { ThemeToggle } from "./ThemeToggle";

type IconType = ComponentType<{ className?: string }>;
type NavDef = { to: string; label: string; icon: IconType };

// When the sidebar renders inside the mobile drawer, tapping any nav link should
// close the drawer. Desktop renders with a no-op. Every NavLink calls this.
const SidebarNavContext = createContext<() => void>(() => {});
const useSidebarNav = () => useContext(SidebarNavContext);

// Regrouped: task filters live under "Tasks"; the calendar is its own tool under
// "Plan" (no longer a peer of "Overdue"). Settings is gone from the nav, it
// lives once, in the profile menu at the bottom.
const TASK_VIEWS: NavDef[] = [
  { to: "/home", label: "Home", icon: HomeIcon },
  { to: "/today", label: "Today", icon: TodayIcon },
  { to: "/upcoming", label: "Upcoming", icon: UpcomingIcon },
  { to: "/overdue", label: "Overdue", icon: OverdueIcon },
  { to: "/backlog", label: "Backlog", icon: BacklogIcon },
  // Directly under Backlog because it is the same kind of place (things with no
  // date) split by the one distinction that matters: Backlog is not scheduled
  // YET, Whenever is never going to be.
  { to: "/whenever", label: "Whenever", icon: WheneverIcon },
  { to: "/snoozed", label: "Snoozed", icon: SnoozeIcon },
  { to: "/logbook", label: "Logbook", icon: LogbookIcon },
];
// Grouped by WHEN you visit, not by theme. Plan = daily planning surface.
// Review = the "did anything slip" rituals (weekly review, mail coverage).
// More = management pages you organise occasionally (cards, cadences); collapsed
// by default so the daily nav stays short.
const PLAN_VIEWS: NavDef[] = [
  { to: "/calendar", label: "Calendar", icon: CalendarIcon },
  { to: "/flow", label: "Flow", icon: FlowIcon },
];
const REVIEW_VIEWS: NavDef[] = [
  { to: "/review", label: "Weekly review", icon: ReviewIcon },
  { to: "/mail", label: "Mail coverage", icon: MailIcon },
];
const MORE_VIEWS: NavDef[] = [
  { to: "/pins", label: "Cards", icon: PinsIcon },
  { to: "/cadences", label: "Cadences", icon: CadenceIcon },
];
const ALL_VIEWS = [...TASK_VIEWS, ...PLAN_VIEWS, ...REVIEW_VIEWS, ...MORE_VIEWS];

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
  onMove,
  alert,
  count,
}: {
  def: NavDef;
  onHide?: () => void;
  // Manage mode only. Up/down rather than drag: the sidebar sits inside the
  // app's DndContext (which is watching for task drags), a nav row is a small
  // target on a phone, and reordering eight items is a thing you do once.
  onMove?: (dir: -1 | 1) => void;
  // `alert` tints the row orange (used by Overdue when it has tasks); `count`
  // shows a trailing pill.
  alert?: boolean;
  count?: number;
}) {
  const Icon = def.icon;
  const closeNav = useSidebarNav();
  const { ref, isOver } = useDrop(dropForView(def.to));
  return (
    <div ref={ref} className="group flex items-center">
      <NavLink
        to={def.to}
        onClick={closeNav}
        // Inline color wins over the text-muted class, so the orange applies in
        // every state (active/hover included) without extra conditionals.
        style={alert ? { color: "var(--area-orange)" } : undefined}
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
        {alert && count != null && count > 0 && (
          <span
            className="ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
            style={{
              color: "var(--area-orange)",
              background: "color-mix(in oklab, var(--area-orange) 16%, transparent)",
            }}
          >
            {count}
          </span>
        )}
      </NavLink>
      {onMove && (
        <>
          <button
            title={`Move ${def.label} up`}
            aria-label={`Move ${def.label} up`}
            onClick={() => onMove(-1)}
            className="h-6 w-5 shrink-0 rounded text-subtle hover:text-foreground"
          >
            ↑
          </button>
          <button
            title={`Move ${def.label} down`}
            aria-label={`Move ${def.label} down`}
            onClick={() => onMove(1)}
            className="h-6 w-5 shrink-0 rounded text-subtle hover:text-foreground"
          >
            ↓
          </button>
        </>
      )}
      {onHide && (
        <button
          title={`Hide ${def.label}`}
          aria-label={`Hide ${def.label}`}
          onClick={onHide}
          // Always visible in manage mode: it sits beside the move arrows there,
          // and a hover-only control next to two permanent ones reads as broken.
          className={cn(
            "mr-1 h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:text-foreground",
            onMove ? "grid" : "hidden group-hover:grid"
          )}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// The rows of one nav section.
//
// Exists because the ordering controls need to know WHICH LIST an item is being
// moved within: "up" means "swap with the row above it in this section", and a
// section that handed the mover a different list would move things it was not
// showing. Four copies of that would be four chances to pass the wrong one.
function NavItems({
  items,
  manage,
  onHide,
  onMove,
  extra,
}: {
  items: NavDef[];
  manage: boolean;
  onHide: (to: string) => void;
  onMove: (to: string, dir: -1 | 1, within: string[]) => void;
  // Per-row decoration the section knows about and this does not (Overdue's
  // count, so far).
  extra?: (d: NavDef) => { alert?: boolean; count?: number };
}) {
  const within = items.map((x) => x.to);
  return (
    <>
      {items.map((s) => (
        <NavItem
          key={s.to}
          def={s}
          onHide={manage ? () => onHide(s.to) : undefined}
          onMove={manage ? (d) => onMove(s.to, d, within) : undefined}
          {...(extra?.(s) ?? {})}
        />
      ))}
    </>
  );
}

// A starred project's sidebar row: straight to the project, area-tinted dot.
function StarredLink({
  project,
  color,
}: {
  project: { id: string; name: string };
  color: string;
}) {
  const closeNav = useSidebarNav();
  return (
    <NavLink
      to={`/project/${project.id}`}
      onClick={closeNav}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 truncate rounded-md px-2 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-surface-2 text-foreground"
            : "text-muted hover:bg-surface-2/60 hover:text-foreground"
        )
      }
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{project.name}</span>
    </NavLink>
  );
}

function AreaNode({ area }: { area: Area }) {
  const { id, name } = area;
  const closeNav = useSidebarNav();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const { data: projects = [] } = useProjects(id);
  const { ref, isOver } = useDrop({ id: `area:${id}`, data: { type: "area", areaId: id } });
  const AreaIcon = areaIcon(area.icon);
  return (
    <div>
      <div className="group flex items-center">
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
          onClick={closeNav}
          className={({ isActive }) =>
            cn(
              "flex flex-1 items-center gap-2 truncate rounded-md px-2 py-1 text-sm transition-colors",
              isActive
                ? "bg-surface-2 text-foreground"
                : "text-foreground/90 hover:bg-surface-2/60",
              isOver && "ring-1 ring-primary"
            )
          }
        >
          {AreaIcon ? (
            <AreaIcon
              className="h-3.5 w-3.5 shrink-0"
              style={{ color: areaColorVar(area.color) }}
            />
          ) : (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: areaColorVar(area.color) }}
            />
          )}
          <span className="truncate">{name}</span>
        </NavLink>
        <button
          onClick={() => setEdit(true)}
          title="Edit area"
          aria-label={`Edit ${name}`}
          className="mr-1 hidden h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:text-foreground group-hover:grid"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="ml-5 border-l border-border pl-2">
          {projects.map((p) => (
            <ProjectItem key={p.id} to={`/project/${p.id}`} label={p.name} projectId={p.id} areaId={id} />
          ))}
        </div>
      )}
      <AreaDialog open={edit} onOpenChange={setEdit} existing={area} />
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
  const closeNav = useSidebarNav();
  const { ref, isOver } = useDrop({
    id: `project:${projectId}`,
    data: { type: "project", projectId, areaId },
  });
  return (
    <div ref={ref}>
      <NavLink
        to={to}
        onClick={closeNav}
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
      <span className="text-xs font-medium uppercase tracking-wide text-subtle">
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
  const closeNav = useSidebarNav();
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
          <DropdownMenuItem
            onSelect={() => {
              navigate("/settings");
              closeNav();
            }}
          >
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

// The sidebar body: header, scrollable nav, profile card. Rendered inside the
// desktop rail (Sidebar) and inside the mobile drawer (MobileSidebar), so it must
// stretch to fill a flex-column parent (both provide h-full).
function SidebarInner() {
  const { data: areas = [] } = useAreas();
  const { data: allProjects = [] } = useProjects();
  const { data: labels = [] } = useLabels();
  const { data: savedFilters = [] } = useSavedFilters();
  const { data: overdue = [] } = useView("overdue");
  // The hand-picked current shortlist; stars are set from a project's ... menu.
  const starred = allProjects.filter((p) => !!p.starred && p.status === "active");
  const { online, pending } = useOnlineStatus();
  const { hide, show, isHidden, orderViews, moveView } = useViewPrefs();
  // Collapsed "More" group, remembered per browser. Default closed: these are
  // occasional management pages, not daily nav.
  const [moreOpen, setMoreOpen] = useState(
    () => localStorage.getItem("cb-sidebar-more") === "open"
  );
  useEffect(() => {
    localStorage.setItem("cb-sidebar-more", moreOpen ? "open" : "closed");
  }, [moreOpen]);
  const closeNav = useSidebarNav();
  const overdueCount = overdue.length;
  const [manage, setManage] = useState(false);
  const [filterDialog, setFilterDialog] = useState(false);
  const [areaDialog, setAreaDialog] = useState(false);

  const hiddenViews = ALL_VIEWS.filter((s) => isHidden(s.to));
  // Hidden ones drop out, then the rest take her order. Both halves of "can I
  // customise this sidebar": what appears, and in what order.
  const visible = (items: NavDef[]) =>
    orderViews(items.filter((s) => !isHidden(s.to)));

  return (
    <>
      <div className="mb-3 flex items-center gap-2 px-1">
        <LogoIcon className="h-5 w-5 text-primary" />
        <span className="font-semibold tracking-tight text-foreground">Checkbox</span>
        <div className="ml-auto flex items-center gap-1">
          {!online && (
            <span
              title={`Offline${pending > 0 ? ` · ${pending} queued` : ""}`}
              className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning"
            >
              {pending > 0 ? `offline · ${pending}` : "offline"}
            </span>
          )}
          {/* Desktop rail only; the mobile top bar carries its own toggle. */}
          <ThemeToggle className="hidden h-7 w-7 md:grid" />
        </div>
      </div>

      <SearchBox />

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
          <NavItems
            items={visible(TASK_VIEWS)
              // Overdue only earns a slot when something is actually overdue
              // (unless you're in manage mode, where every view stays visible to
              // toggle).
              .filter((s) => s.to !== "/overdue" || manage || overdueCount > 0)}
            manage={manage}
            onHide={hide}
            onMove={moveView}
            extra={(s) => ({
              alert: s.to === "/overdue" && overdueCount > 0,
              count: s.to === "/overdue" ? overdueCount : undefined,
            })}
          />
        </nav>

        {/* Plan */}
        {visible(PLAN_VIEWS).length > 0 && (
          <>
            <div className="mt-5" />
            <SectionHeader title="Plan" />
            <nav className="space-y-0.5">
              <NavItems
                  items={visible(PLAN_VIEWS)}
                  manage={manage}
                  onHide={hide}
                  onMove={moveView}
                />
            </nav>
          </>
        )}

        {/* Review: the "did anything slip" rituals. */}
        {visible(REVIEW_VIEWS).length > 0 && (
          <>
            <div className="mt-5" />
            <SectionHeader title="Review" />
            <nav className="space-y-0.5">
              <NavItems
                  items={visible(REVIEW_VIEWS)}
                  manage={manage}
                  onHide={hide}
                  onMove={moveView}
                />
            </nav>
          </>
        )}

        {/* More: occasional management pages, collapsed by default. The header
            itself is the toggle. Manage mode forces it open so the hide
            buttons stay reachable. */}
        {visible(MORE_VIEWS).length > 0 && (
          <>
            <div className="mt-5" />
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              className="mb-1 flex w-full items-center gap-1 px-2 text-xs font-medium uppercase tracking-wide text-subtle transition-colors hover:text-foreground"
            >
              {moreOpen || manage ? (
                <ChevronDownIcon className="h-3 w-3" />
              ) : (
                <ChevronRightIcon className="h-3 w-3" />
              )}
              More
            </button>
            {(moreOpen || manage) && (
              <nav className="space-y-0.5">
                <NavItems
                  items={visible(MORE_VIEWS)}
                  manage={manage}
                  onHide={hide}
                  onMove={moveView}
                />
              </nav>
            )}
          </>
        )}

        {/* Hidden (manage mode) */}
        {manage && hiddenViews.length > 0 && (
          <div className="mt-2 rounded-md border border-border p-2">
            <div className="mb-1 px-1 text-xs uppercase tracking-wide text-subtle">
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

        {/* Starred projects: the current shortlist, one click from anywhere.
            Renders only when at least one star exists, so the sidebar spends
            no height on an empty concept. */}
        {starred.length > 0 && (
          <>
            <div className="mt-5" />
            <SectionHeader title="Starred" />
            <div className="space-y-0.5">
              {starred.map((p) => {
                const area = areas.find((a) => a.id === p.area_id);
                return (
                  <StarredLink key={p.id} project={p} color={areaColorVar(area?.color)} />
                );
              })}
            </div>
          </>
        )}

        {/* Areas */}
        <div className="mt-5" />
        <SectionHeader
          title="Areas"
          action={
            <button
              onClick={() => setAreaDialog(true)}
              title="New area"
              className="grid h-5 w-5 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <AddIcon className="h-3.5 w-3.5" />
            </button>
          }
        />
        <div className="space-y-0.5">
          {areas.map((a) => (
            <AreaNode key={a.id} area={a} />
          ))}
          {areas.length === 0 && (
            <button
              onClick={() => setAreaDialog(true)}
              className="w-full rounded-md border border-dashed border-border px-2 py-1.5 text-left text-xs text-subtle hover:border-primary/50 hover:text-foreground"
            >
              + Add your first area (e.g. Work, Health)
            </button>
          )}
        </div>

        {/* Templates */}
        <TemplatesSection />

        {/* Filters */}
        <div className="mt-5" />
        <SectionHeader
          title="Filters"
          action={
            <button
              onClick={() => setFilterDialog(true)}
              title="New filter"
              className="grid h-5 w-5 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <AddIcon className="h-3.5 w-3.5" />
            </button>
          }
        />
        <nav className="space-y-0.5">
          {savedFilters.map((f) => (
            <NavLink
              key={f.id}
              to={`/filter/${f.id}`}
              onClick={closeNav}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-surface-2 text-foreground"
                    : "text-muted hover:bg-surface-2/60 hover:text-foreground"
                )
              }
            >
              <FilterIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{f.name}</span>
            </NavLink>
          ))}
          {savedFilters.length === 0 && (
            <p className="px-2 text-xs text-subtle">No filters yet. Click +</p>
          )}
        </nav>

        {/* Labels. Her report: "now that I have a lot of labels it's very
            crowded." Measured before changing anything: 68 labels, 28 of them
            with NO open task, and the top ten carrying most of the weight. So a
            third of that wall led nowhere and the rest was ordered by nothing
            useful (alphabetically).

            Now: the ones with open work, heaviest first, capped at a handful,
            with everything else one click away. Nothing becomes unreachable,
            it just stops being permanently in the way. */}
        {labels.length > 0 && <LabelStrip labels={labels} onNavigate={closeNav} />}
      </div>

      <ProfileCard />
      <FilterDialog open={filterDialog} onOpenChange={setFilterDialog} />
      <AreaDialog open={areaDialog} onOpenChange={setAreaDialog} />
    </>
  );
}

// The label list, kept short by default.
//
// LABEL_PEEK is the whole design: a sidebar section earns its height by what you
// click, and on her data the click-through is concentrated in the top handful.
// Sorted by open tasks rather than by name, because "which of these has anything
// in it" is the question you are actually asking when you glance at this list.
const LABEL_PEEK = 8;

function LabelStrip({
  labels,
  onNavigate,
}: {
  labels: Label[];
  onNavigate: () => void;
}) {
  const [all, setAll] = useState(false);
  // Heaviest first. A label with no open task is not offered by default: there
  // is nothing behind it to go and look at. It comes back under "show all", so
  // an old label is still reachable and still renameable.
  const ranked = [...labels].sort(
    (a, b) =>
      (b.open_count ?? 0) - (a.open_count ?? 0) || a.name.localeCompare(b.name)
  );
  const live = ranked.filter((l) => (l.open_count ?? 0) > 0);
  const shown = all ? ranked : live.slice(0, LABEL_PEEK);
  const hidden = ranked.length - shown.length;

  return (
    <>
      <div className="mt-5" />
      <SectionHeader title="Labels" />
      <div className="flex flex-wrap gap-1 px-1">
        {shown.map((l) => (
          <NavLink
            key={l.id}
            to={`/label/${encodeURIComponent(l.name)}`}
            onClick={onNavigate}
            // The count lives in the tooltip, not on the chip: printed, it would
            // roughly double the width of every chip to answer a question you
            // only ask occasionally, and the ORDER already tells you the shape.
            title={`@${l.name} · ${l.open_count ?? 0} open`}
            className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface-2/70 hover:text-foreground"
          >
            @{l.name}
          </NavLink>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            title="Includes labels with no open tasks"
            className="rounded px-1.5 py-0.5 text-[11px] text-subtle transition-colors hover:text-foreground"
          >
            +{hidden} more
          </button>
        )}
        {all && (
          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded px-1.5 py-0.5 text-[11px] text-subtle transition-colors hover:text-foreground"
          >
            less
          </button>
        )}
      </div>
    </>
  );
}

// Desktop rail: persistent, hidden below md where the drawer takes over.
export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/60 p-3 md:flex">
      <SidebarInner />
    </aside>
  );
}

// Mobile drawer: same content in a left slide-over. Tapping any nav link (or the
// overlay) closes it via SidebarNavContext.
export function MobileSidebar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[17rem] max-w-[85vw] flex-col gap-0 bg-surface p-3"
      >
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <SidebarNavContext.Provider value={() => onOpenChange(false)}>
          <SidebarInner />
        </SidebarNavContext.Provider>
      </SheetContent>
    </Sheet>
  );
}
