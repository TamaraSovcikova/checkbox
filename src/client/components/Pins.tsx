import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Pin, PinItem, Task } from "../../shared/types";
import {
  usePins,
  useCreatePin,
  useUpdatePin,
  useDeletePin,
  useAreas,
  useProjects,
  useTasks,
  useTasksByIds,
  useCompleteTask,
} from "../lib/queries";
import { useTaskUI } from "../lib/ui-context";
import { AREA_COLORS, areaColorVar } from "../lib/colors";
import {
  pinsForScope,
  scopeLabel,
  scopeOptions,
  isLoose,
  spotOptions,
  spotValueOf,
  spotLabel,
  decodeSpot,
} from "../lib/pinScope";
import { CadenceStrip } from "./Cadences";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";
import {
  PinsIcon,
  TrashIcon,
  AddIcon,
  NotesIcon,
  SubtaskIcon,
  CadenceIcon,
  MoreIcon,
  SearchIcon,
  ChevronDownIcon,
  LinkIcon,
} from "../lib/icons";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";

const newItem = (text: string): PinItem => ({
  id: crypto.randomUUID(),
  text,
  done: false,
});

type Placement = Pin["placement"];

// Compact colour picker: a swatch that opens the area-colour palette inline.
function ColorPicker({
  color,
  onPick,
}: {
  color: string | null;
  onPick: (c: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Colour"
        aria-label="Colour"
        className="grid h-6 w-6 place-items-center rounded hover:bg-surface-2"
      >
        <span
          className="h-3 w-3 rounded-full border border-border"
          style={{ background: color ? areaColorVar(color) : "transparent" }}
        />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1.5 shadow-lg">
          <button
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            title="No colour"
            className="h-4 w-4 rounded-full border border-border bg-transparent"
          />
          {AREA_COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                onPick(c.key);
                setOpen(false);
              }}
              title={c.label}
              className={cn(
                "h-4 w-4 rounded-full",
                color === c.key && "ring-2 ring-offset-1 ring-offset-surface"
              )}
              style={{ background: c.var }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Discreet per-pin menu: placement (top / side / off) + delete, behind one small
// icon so it never crowds the card.
function PinMenu({
  placement,
  showPlacement,
  onSet,
  onDelete,
}: {
  placement: Placement;
  showPlacement: boolean;
  onSet: (p: Placement) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Pin options"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-subtle transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2"
        >
          <MoreIcon className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {showPlacement && (
          <>
            <DropdownMenuCheckboxItem
              checked={placement === "top"}
              onSelect={() => onSet(placement === "top" ? "unpinned" : "top")}
            >
              Show at top
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={placement === "side"}
              onSelect={() => onSet(placement === "side" ? "unpinned" : "side")}
            >
              Show in side column
            </DropdownMenuCheckboxItem>
          </>
        )}
        <DropdownMenuItem className="text-danger" onSelect={onDelete}>
          Delete pin
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A pin's body text. ONE element, always a textarea, grown to fit its content.
//
// It used to swap between a full-height preview button and a `rows={2}`
// textarea, so clicking a long reminder collapsed it into a two-line scroller
// and you had to scroll to reach the sentence you had just clicked on. Keeping a
// single element removes the whole class of problem: there is no height change,
// no focus to hand over, and the caret lands exactly where you clicked, because
// that is simply what clicking a textarea does.
//
// Growing (rather than scrolling) is safe because the caller already wraps this
// in a `min-h-0 flex-1 overflow-y-auto` container, so a pin with a dragged
// height scrolls at the card level instead.
function PinBody({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Measured before paint, so the box is never briefly the wrong size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      placeholder="Your reminder, goal or quote…"
      rows={1}
      className="w-full resize-none overflow-hidden bg-transparent text-[13px] leading-snug text-foreground outline-none placeholder:text-subtle"
    />
  );
}

// Pick an open task to put on a pin. The pin stores only the id, so the task's
// own title stays the source of truth afterwards.
//
// Searches the task's AREA and PROJECT names as well as its title, because by the
// time you are pinning something you usually know where it lives ("that thing in
// Finance") sooner than you can recall how you worded it. Each hit shows where it
// came from too: matching on a project you cannot see would be its own puzzle,
// and titles alone are often ambiguous across areas.
function TaskPicker({
  tasks,
  exclude,
  onPick,
}: {
  tasks: Task[];
  exclude: Set<string>;
  onPick: (t: Task) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects();

  const where = (t: Task) => {
    const area = areas.find((a) => a.id === t.area_id);
    const project = projects.find((p) => p.id === t.project_id);
    return { area, project };
  };

  const needle = q.trim().toLowerCase();
  const matches = tasks
    .filter((t) => t.status !== "done" && !exclude.has(t.id))
    .filter((t) => {
      if (!needle) return true;
      const { area, project } = where(t);
      // One haystack, so "finance bills" matches a task titled "bills" in the
      // Finance area. Every term must appear somewhere, in any order.
      const hay = [t.title, area?.name, project?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return needle.split(/\s+/).every((term) => hay.includes(term));
    })
    .slice(0, 8);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Link a task"
          title="Link a task"
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-subtle transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tasks, areas, projects"
          className="mb-1 h-8 w-full rounded border border-input bg-surface px-2 text-xs text-foreground outline-none placeholder:text-subtle focus:border-primary"
        />
        <div className="max-h-56 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-subtle">
              {q ? "No open task matches." : "No open tasks to link."}
            </p>
          ) : (
            matches.map((t) => {
              const { area, project } = where(t);
              const place = [area?.name, project?.name].filter(Boolean).join(" › ");
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    onPick(t);
                    setQ("");
                    setOpen(false);
                  }}
                  className="block w-full rounded px-1.5 py-1 text-left hover:bg-surface-2"
                >
                  <span className="block truncate text-xs text-foreground">{t.title}</span>
                  {place && (
                    <span className="mt-0.5 flex items-center gap-1 text-[10px] text-subtle">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: areaColorVar(area?.color) }}
                      />
                      <span className="truncate">{place}</span>
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// A pin line that IS a task. The task row is authoritative: live title, live
// status, and ticking it here completes the task itself rather than the line.
function LinkedTaskLine({
  item,
  task,
  onUnlink,
}: {
  item: PinItem;
  task: Task | undefined;
  onUnlink: () => void;
}) {
  const complete = useCompleteTask();
  const { open } = useTaskUI();

  // Linked task deleted from under us. Say so instead of rendering a ghost line,
  // and offer the only useful action left.
  if (!task) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-subtle line-through">
          {item.text || "(task deleted)"}
        </span>
        <button
          onClick={onUnlink}
          aria-label="Remove line"
          title="This task no longer exists"
          className="shrink-0 text-subtle hover:text-danger"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const isDone = task.status === "done";
  return (
    <div className="group/line flex items-center gap-2">
      <input
        type="checkbox"
        checked={isDone}
        onChange={() => complete.mutate({ id: task.id, done: !isDone })}
        className="h-3.5 w-3.5 shrink-0 [accent-color:var(--primary)]"
        aria-label={task.title}
      />
      <button
        onClick={() => open(task)}
        title="Open task"
        className={cn(
          "min-w-0 flex-1 truncate text-left text-[13px] text-foreground",
          isDone && "text-subtle line-through"
        )}
      >
        {task.title}
      </button>
      {/* A link icon marks this as a task, not a line you typed. */}
      <LinkIcon className="h-3 w-3 shrink-0 text-subtle opacity-60" />
      <button
        onClick={onUnlink}
        aria-label="Unlink task"
        title="Unlink (does not delete the task)"
        className="hidden shrink-0 text-subtle hover:text-danger group-hover/line:block"
      >
        <TrashIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

// Pins in a strip lay out on a 4-column grid, so a pin can be a quarter, a half
// (the default, and what every pin was before sizing existed) or the full width.
export const PIN_COLS = 4;
const PIN_GAP = 8; // matches gap-2 on the strip grid

// How a pin may be resized where it is being shown:
//   "both"   - strip: drag width (snaps to grid columns) and height
//   "height" - side column: fixed width, so height only
//   "none"   - Pins page: that page is for organising, not laying out
type ResizeMode = "none" | "height" | "both";

// One pin: a living checklist ('list') or a standing reminder ('note'). Used on
// the Pins page (full) and in the Today strip / side column (compact).
function PinCard({
  pin,
  compact,
  resize = "none",
}: {
  pin: Pin;
  compact?: boolean;
  resize?: ResizeMode;
}) {
  const update = useUpdatePin();
  const del = useDeletePin();
  const { data: areas = [] } = useAreas();
  // Open tasks, for the picker to search. Shared across every pin: TanStack
  // dedupes on the ["tasks", {}] key, so this is one fetch for the page.
  const { data: allTasks = [] } = useTasks({});
  const [title, setTitle] = useState(pin.title ?? "");
  const [items, setItems] = useState<PinItem[]>(pin.items ?? []);
  const [body, setBody] = useState(pin.body ?? "");
  const [newLine, setNewLine] = useState("");

  useEffect(() => {
    setTitle(pin.title ?? "");
    setItems(pin.items ?? []);
    setBody(pin.body ?? "");
  }, [pin]);

  function saveItems(next: PinItem[]) {
    setItems(next);
    update.mutate({ id: pin.id, body: { items: next } });
  }
  const toggle = (id: string) =>
    saveItems(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const editItem = (id: string, text: string) =>
    setItems(items.map((i) => (i.id === id ? { ...i, text } : i)));
  const commitItem = () => update.mutate({ id: pin.id, body: { items } });
  const removeItem = (id: string) => saveItems(items.filter((i) => i.id !== id));
  function addLine() {
    const t = newLine.trim();
    if (!t) return;
    saveItems([...items, newItem(t)]);
    setNewLine("");
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  // Live size while dragging; null means "use what's stored". Committing on
  // pointerup (not on every move) keeps this to one write per drag.
  const cardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ span: number; height: number } | null>(null);

  function onResizeDown(e: ReactPointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = cardRef.current;
    if (!el) return;
    const startRect = el.getBoundingClientRect();
    // Column width is derived from the grid we are actually sitting in, so the
    // snap stays honest at any window width.
    const gridW = el.parentElement?.getBoundingClientRect().width ?? startRect.width;
    const colW = (gridW - PIN_GAP * (PIN_COLS - 1)) / PIN_COLS;
    const startX = e.clientX;
    const startY = e.clientY;
    const startSpan = pin.span ?? 2;
    const startH = startRect.height;

    let next = { span: startSpan, height: startH };
    const onMove = (ev: PointerEvent) => {
      const w = startRect.width + (ev.clientX - startX);
      const span =
        resize === "both"
          ? Math.max(1, Math.min(PIN_COLS, Math.round((w + PIN_GAP) / (colW + PIN_GAP))))
          : startSpan;
      const height = Math.max(60, Math.min(800, Math.round(startH + (ev.clientY - startY))));
      next = { span, height };
      setDrag(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      update.mutate({ id: pin.id, body: next });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const span = drag?.span ?? pin.span ?? 2;
  const height = drag?.height ?? pin.height ?? null;

  const linkedIds = new Set(
    items.map((i) => i.task_id).filter((x): x is string => !!x)
  );
  const linkedItems = items.filter((i) => i.task_id);
  // Resolved by id rather than from the open-task list above, which omits done
  // tasks: a linked task you tick off must stay put, ticked, not read as deleted.
  const { data: linkedTasks = [] } = useTasksByIds([...linkedIds]);
  const taskById = new Map(linkedTasks.map((t) => [t.id, t]));
  const addTaskItem = (t: Task) =>
    // `text` is a fallback label only, for if the task is later deleted.
    saveItems([...items, { id: crypto.randomUUID(), text: t.title, done: false, task_id: t.id }]);

  // A linked line is done when its TASK is done, not when the line says so.
  const isItemDone = (i: PinItem) =>
    i.task_id ? taskById.get(i.task_id)?.status === "done" : i.done;
  const done = items.filter(isItemDone).length;
  const accent = pin.color ? areaColorVar(pin.color) : null;
  const [editingTitle, setEditingTitle] = useState(false);
  // Titles are optional and take NO space when absent: show the input only when
  // there's a title or you're adding one; on the page an untitled pin offers a
  // subtle "+ title", on compact cards it shows nothing at all.
  const hasTitle = title.trim().length > 0;
  const showTitleInput = hasTitle || editingTitle;

  return (
    <div
      ref={cardRef}
      className={cn(
        "group relative flex flex-col rounded-lg border bg-surface p-3",
        compact && "bg-surface/60",
        drag && "select-none"
      )}
      style={{
        ...(accent
          ? { borderLeftColor: accent, borderLeftWidth: 3 }
          : { borderColor: "var(--border)" }),
        // A pin only spans columns where there IS a grid to span (the strip).
        ...(resize === "both" ? { gridColumn: `span ${span}` } : null),
        ...(resize !== "none" && height ? { height } : null),
      }}
    >
      <div className="mb-1.5 flex shrink-0 items-center gap-2">
        <span className="shrink-0 text-subtle">
          {pin.kind === "tracker" ? (
            <CadenceIcon className="h-3.5 w-3.5" />
          ) : pin.kind === "list" ? (
            <SubtaskIcon className="h-3.5 w-3.5" />
          ) : (
            <NotesIcon className="h-3.5 w-3.5" />
          )}
        </span>
        {showTitleInput ? (
          <input
            value={title}
            autoFocus={editingTitle}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              if (title !== (pin.title ?? "")) update.mutate({ id: pin.id, body: { title } });
            }}
            placeholder="Title"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-subtle"
          />
        ) : compact ? (
          <span className="flex-1" />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="flex-1 text-left text-xs text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            + title
          </button>
        )}
        {pin.kind === "list" && items.length > 0 && (
          <span className="shrink-0 text-[11px] text-subtle">
            {done}/{items.length}
          </span>
        )}
        <TaskPicker tasks={allTasks} exclude={linkedIds} onPick={addTaskItem} />
        <ColorPicker
          color={pin.color}
          onPick={(c) => update.mutate({ id: pin.id, body: { color: c } })}
        />
        <PinMenu
          placement={pin.placement}
          // The full Pins-page card has the "Show on" select for placement, so
          // the menu there only needs Delete. In situ (compact) it is the only
          // control, so it keeps the quick top/side/unpin toggles.
          showPlacement={!!compact}
          onSet={(p) => update.mutate({ id: pin.id, body: { placement: p } })}
          onDelete={() => del.mutate(pin.id)}
        />
      </div>

      {/* min-h-0 so this can actually shrink inside the flex column: without it
          a fixed-height pin would be pushed taller by its own content. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {pin.kind === "tracker" ? (
        // Scoped to the area it is pinned to, when it is pinned to one, so an
        // area's cadence card shows that area's gauges rather than all of them.
        <CadenceStrip
          areaId={pin.scope?.startsWith("area:") ? pin.scope.slice(5) : null}
          limit={compact ? 4 : 6}
        />
      ) : pin.kind === "list" ? (
        <div className="space-y-0.5">
          {items.map((it) =>
            it.task_id ? (
              <LinkedTaskLine
                key={it.id}
                item={it}
                task={taskById.get(it.task_id)}
                onUnlink={() => removeItem(it.id)}
              />
            ) : (
            <div key={it.id} className="group flex items-center gap-2">
              <input
                type="checkbox"
                checked={it.done}
                onChange={() => toggle(it.id)}
                className="h-3.5 w-3.5 shrink-0 [accent-color:var(--primary)]"
                aria-label={it.text}
              />
              <input
                value={it.text}
                onChange={(e) => editItem(it.id, e.target.value)}
                onBlur={commitItem}
                className={cn(
                  "min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none",
                  it.done && "text-subtle line-through"
                )}
              />
              <button
                onClick={() => removeItem(it.id)}
                aria-label="Remove line"
                className="hidden shrink-0 text-subtle hover:text-danger group-hover:block"
              >
                <TrashIcon className="h-3 w-3" />
              </button>
            </div>
            )
          )}
          <div className="mt-1 flex items-center gap-2">
            <AddIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
            <input
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLine()}
              onBlur={addLine}
              placeholder="Add a line"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
            />
          </div>
        </div>
      ) : (
        <PinBody
          value={body}
          onChange={setBody}
          onCommit={() => {
            if (body !== (pin.body ?? "")) update.mutate({ id: pin.id, body: { body } });
          }}
        />
      )}

      {/* A reminder's linked tasks. A note has no lines of its own, so these sit
          under the text rather than in it, and it stays a reminder, not a list. */}
      {pin.kind === "note" && linkedItems.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-border pt-2">
          {linkedItems.map((it) => (
            <LinkedTaskLine
              key={it.id}
              item={it}
              task={taskById.get(it.task_id as string)}
              onUnlink={() => removeItem(it.id)}
            />
          ))}
        </div>
      )}
      </div>

      {/* Where this pin shows, as one chip (scope + placement together). Only on
          the Pins page (full card): that is where you organise, and it would be
          noise on the pin itself in situ. The chip reads the current home
          ("Loose", "Today · top strip") and opens the move menu. */}
      {!compact && (
        <div className="mt-2 border-t border-border pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "inline-flex h-6 max-w-full items-center gap-1 truncate rounded-full border px-2 text-[11px] transition-colors",
                  isLoose(pin)
                    ? "border-dashed border-border text-subtle hover:text-foreground"
                    : "border-border bg-surface-2 text-foreground hover:bg-surface"
                )}
              >
                <span className="truncate">{spotLabel(pin, areas)}</span>
                <ChevronDownIcon className="h-3 w-3 shrink-0 text-subtle" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {spotOptions(areas).map((grp, i) => (
                <div key={grp.group || "nowhere"}>
                  {i > 0 && <DropdownMenuSeparator />}
                  {grp.group && <DropdownMenuLabel>{grp.group}</DropdownMenuLabel>}
                  {grp.options.map((o) => (
                    <DropdownMenuCheckboxItem
                      key={o.value}
                      checked={spotValueOf(pin) === o.value}
                      onCheckedChange={() => {
                        const { scope, placement } = decodeSpot(o.value);
                        update.mutate({ id: pin.id, body: { scope, placement } });
                      }}
                    >
                      {o.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Corner grip. Stays out of the way until you hover the pin. */}
      {resize !== "none" && (
        <div
          onPointerDown={onResizeDown}
          role="separator"
          aria-label="Resize pin"
          title={resize === "both" ? "Drag to resize" : "Drag to set height"}
          className={cn(
            "absolute bottom-0 right-0 h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100",
            resize === "both" ? "cursor-nwse-resize" : "cursor-ns-resize",
            drag && "opacity-100"
          )}
        >
          <svg viewBox="0 0 10 10" className="h-full w-full text-subtle" aria-hidden="true">
            <path d="M9 3 L3 9 M9 6.5 L6.5 9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

// Make a pin on the page you are standing on, already attached to it.
//
// The Pins page could always do this, but only by making a pin and then telling
// it where to live in a "Show on" dropdown: you had to leave the area, create,
// then re-select the area you had just come from. The scope is not a decision
// when you are already on the page, so it should not be a question. The server
// has always accepted a scope on create (routes/pins.ts); nothing was passing one.
//
// `placement: "top"` so the new pin lands in the strip at the top of the page and
// you can see the thing you just made. Side placement is a move away on the card.
export function useAddPin(scope: string) {
  const create = useCreatePin();
  return {
    addList: () => create.mutate({ kind: "list", placement: "top", scope }),
    addNote: () => create.mutate({ kind: "note", placement: "top", scope }),
    // A cadence card. Placed on the side, where a gauge you glance at belongs,
    // rather than in the top strip competing with the work itself.
    addTracker: () => create.mutate({ kind: "tracker", placement: "side", scope }),
  };
}

// Full-width strip at the top of a page: that page's pins placed 'top'.
// `scope` names the page (see lib/pinScope); defaults to Today.
export function PinsStrip({ scope = "today" }: { scope?: string }) {
  const { data: pins = [] } = usePins();
  const top = pinsForScope(pins, scope).filter((p) => p.placement === "top");
  if (top.length === 0) return null;
  return (
    <div className="mb-4 grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-4">
      {top.map((p) => (
        <PinCard key={p.id} pin={p} compact resize="both" />
      ))}
    </div>
  );
}

// Narrow right column: that page's pins placed 'side'.
//
// `inline` means the caller already owns the rail (Today does, when it is also
// showing the day timeline): render just the cards, no second column of our own.
// The side-placed pins for a scope. Exported so a caller can tell whether the
// rail has anything to show BEFORE deciding to draw tabs for it: one pane needs
// no tab bar.
export function useSidePins(scope: string) {
  const { data: pins = [] } = usePins();
  return pinsForScope(pins, scope).filter((p) => p.placement === "side");
}

export function PinsSide({
  scope = "today",
  inline,
}: {
  scope?: string;
  inline?: boolean;
}) {
  const side = useSidePins(scope);
  if (side.length === 0) return null;
  const cards = side.map((p) => (
    <PinCard key={p.id} pin={p} compact resize="height" />
  ));
  if (inline) return <div className="mt-2 space-y-2">{cards}</div>;
  return (
    <aside className="mt-4 space-y-2 lg:mt-0 lg:w-64 lg:shrink-0">{cards}</aside>
  );
}

// Does a pin match what you typed? Searches everything you can read on the card,
// including list lines, because "the pin with milk on it" is how you look for it.
function pinMatches(pin: Pin, q: string): boolean {
  if (!q) return true;
  const hay = [pin.title ?? "", pin.body ?? "", ...(pin.items ?? []).map((i) => i.text)]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

// The Pins management page (sidebar → Pins).
export function PinsPage() {
  const { data: pins = [] } = usePins();
  const { data: areas = [] } = useAreas();
  const create = useCreatePin();
  const [q, setQ] = useState("");
  // Which chip is active: "all", "loose", or a page scope. Filtering, not
  // collapsible sections: sections hid every card behind bare header rows, so
  // the page showed nothing. With chips the cards are always on screen and the
  // chip row doubles as the count-per-page overview.
  const [filter, setFilter] = useState("all");

  const found = pins.filter((p) => pinMatches(p, q));

  // Loose pins (not on any page) get their own chip, first: they are the "just
  // a list I keep" pile and their scope is meaningless, so bucketing them under
  // Today (their default scope) was the old confusion. The rest bucket by the
  // page they live on, in the picker's order so the chip row is stable.
  const loose = found.filter(isLoose);
  const placed = found.filter((p) => !isLoose(p));
  const order = scopeOptions(areas).map((o) => o.value);
  const placedGroups = [...new Set(placed.map((p) => p.scope || "today"))]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .map((scope) => ({
      key: scope,
      label: scopeLabel(scope, areas),
      pins: placed.filter((p) => (p.scope || "today") === scope),
    }));
  const chips = [
    { key: "all", label: "All", count: found.length },
    ...(loose.length ? [{ key: "loose", label: "Loose", count: loose.length }] : []),
    ...placedGroups.map((g) => ({ key: g.key, label: g.label, count: g.pins.length })),
  ];
  // A chip can vanish under you (last pin moved off a page, or a search that
  // empties it); fall back to All rather than showing an empty grid.
  const active = chips.some((c) => c.key === filter) ? filter : "all";
  const visible =
    active === "all"
      ? [...loose, ...placedGroups.flatMap((g) => g.pins)]
      : active === "loose"
        ? loose
        : (placedGroups.find((g) => g.key === active)?.pins ?? []);

  return (
    <div className="max-w-4xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <PinsIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Pins</h1>
        {pins.length > 0 && (
          <span className="text-xs text-subtle">
            {pins.length} pin{pins.length === 1 ? "" : "s"}
            {loose.length > 0 && ` · ${loose.length} loose`}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-subtle">
        Lists and reminders you keep beside your tasks. The chip on each card
        says where it shows; click it to move the pin between Loose (kept here
        only), Today, or an area. Colour them to tell them apart; drag a pinned
        card&rsquo;s corner where it shows to resize it.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* New pins start LOOSE (not on any page): the Pins page is where you
            keep lists, and putting one on Today/an area is a deliberate later
            step via "Show on". The area/view ... menus still create pins already
            attached to that page - there the placement is the whole point. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "list", placement: "unpinned" })}
        >
          <AddIcon className="h-4 w-4" /> New list
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "note", placement: "unpinned" })}
        >
          <AddIcon className="h-4 w-4" /> New reminder
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "tracker", placement: "unpinned" })}
        >
          <AddIcon className="h-4 w-4" /> New cadence card
        </Button>

        {pins.length > 0 && (
          <div className="relative ml-auto">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search pins"
              className="h-8 w-44 rounded-md border border-input bg-surface pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-subtle focus:border-primary"
            />
          </div>
        )}
      </div>

      {/* Page filter. Only pages that have pins get a chip, so the row is also
          the "what lives where" overview at a glance. */}
      {found.length > 0 && chips.length > 2 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                active === c.key
                  ? "border-primary bg-primary/10 font-medium text-foreground"
                  : "border-border text-subtle hover:text-foreground"
              )}
            >
              {c.label}
              <span className="text-[11px] tabular-nums text-muted">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {pins.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/40 p-6 text-center">
          <PinsIcon className="mx-auto mb-2 h-6 w-6 text-subtle" />
          <p className="text-sm text-subtle">
            No pins yet. A list is good for a running shopping list or conversation
            topics; a reminder is good for a goal or a quote you go by.
          </p>
        </div>
      ) : found.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface/40 p-4 text-center text-sm text-subtle">
          Nothing matches &ldquo;{q}&rdquo;.
        </p>
      ) : (
        // One flat grid, loose pins first. Each card carries its own location
        // chip, so no section headers are needed to say what lives where.
        <div className="grid gap-2 sm:grid-cols-2">
          {visible.map((p) => (
            <PinCard key={p.id} pin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
