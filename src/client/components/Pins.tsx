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
import { useCompleteGuard } from "../lib/use-complete-guard";
import { AREA_COLORS, areaColorVar, areaTintBg } from "../lib/colors";
import { Markdown } from "../lib/markdown";
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
  CheckIcon,
  ChevronRightIcon,
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
import { PageIntro } from "./PageIntro";

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

// The round tick used on card lines, matching the task rows rather than the
// browser's native square checkbox, which read as a form rather than a list.
function CheckDot({
  checked,
  onToggle,
  label,
  accent,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  accent: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "mt-[2px] grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] transition-colors",
        !checked && "border-subtle/70 hover:border-[var(--dot)]"
      )}
      style={
        {
          "--dot": accent,
          ...(checked ? { background: accent, borderColor: accent } : null),
        } as React.CSSProperties
      }
    >
      {checked && <CheckIcon className="h-2.5 w-2.5 text-[var(--primary-foreground)]" strokeWidth={3} />}
    </button>
  );
}

// A long list shows this many open lines on the Cards page before folding the
// rest behind "Show N more". Ten items stacked in a grid cell was most of the
// "long clunky list" complaint (#4).
const OPEN_LINES_SHOWN = 6;

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
          aria-label="Card options"
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
          Delete card
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
  // Markdown at rest, textarea while editing. The single-element rule above
  // guarded against a HEIGHT jump (the old preview collapsed to a 2-row
  // scroller); both sides here auto-grow to their content, so the swap keeps
  // the height and the caret lands on click-to-edit via autoFocus.
  const [editing, setEditing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  if (!editing && value.trim()) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
        className="cursor-text text-[13px] leading-snug text-foreground [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_strong]:font-semibold [&_p+p]:mt-1"
      >
        <Markdown text={value} />
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      autoFocus={editing}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        onCommit();
        setEditing(false);
      }}
      placeholder={'Text… ("- " bullets, **bold**)'}
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
// A card line's text: always fully visible, wrapping onto as many lines as it
// needs, and editable in place.
//
// It was a single-line <input>, which cannot wrap by definition: a long line
// scrolled sideways inside the field and the rest of it simply was not on the
// screen. Her words: "I want to be able to see all the text all the time".
//
// Same trick as the task sheet's SubtaskTitle, and the same reasoning: a
// textarea sized to its own scrollHeight on every render and every keystroke, so
// the row is exactly as tall as the words in it.
export function PinLineText({
  value,
  done,
  onChange,
  onCommit,
}: {
  value: string;
  done: boolean;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const fit = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      value={value}
      rows={1}
      ref={fit}
      onChange={(e) => {
        onChange(e.target.value);
        fit(e.target);
      }}
      onBlur={onCommit}
      // Enter commits rather than opening a second line: these are checklist
      // lines, and the wrapping is for long text, not for paragraphs.
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      }}
      className={cn(
        "min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[13px] leading-snug text-foreground outline-none",
        done && "text-subtle line-through"
      )}
    />
  );
}

function LinkedTaskLine({
  item,
  task,
  onUnlink,
  accent,
}: {
  item: PinItem;
  task: Task | undefined;
  onUnlink: () => void;
  accent: string;
}) {
  const complete = useCompleteTask();
  const { guard, dialog } = useCompleteGuard();
  const { open } = useTaskUI();

  // Linked task deleted from under us. Say so instead of rendering a ghost line,
  // and offer the only useful action left.
  if (!task) {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[13px] text-subtle line-through">
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
    // items-start, not items-center: a title that wraps to three lines should
    // keep its checkbox beside the FIRST line, not floating in the middle.
    <div className="group/line flex items-start gap-2">
      <CheckDot
        checked={isDone}
        // Ticking a pinned task off is completing it, so it asks about open
        // steps like everywhere else. Un-ticking never asks.
        onToggle={() =>
          guard(task, () => complete.mutate({ id: task.id, done: !isDone }))
        }
        label={task.title}
        accent={accent}
      />
      <button
        onClick={() => open(task)}
        title="Open task"
        className={cn(
          "min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-[13px] leading-snug text-foreground",
          isDone && "text-subtle line-through"
        )}
      >
        {task.title}
      </button>
      {/* A link icon marks this as a task, not a line you typed. */}
      <LinkIcon className="mt-1 h-3 w-3 shrink-0 text-subtle opacity-60" />
      <button
        onClick={onUnlink}
        aria-label="Unlink task"
        title="Unlink (does not delete the task)"
        className="hidden shrink-0 text-subtle hover:text-danger group-hover/line:block"
      >
        <TrashIcon className="h-3 w-3" />
      </button>
      {dialog}
    </div>
  );
}

// One line of a list card: a typed line, or a linked task (which owns its own
// title and done state).
function ListLine({
  it,
  task,
  accent,
  onToggle,
  onEdit,
  onCommit,
  onRemove,
}: {
  it: PinItem;
  task: Task | undefined;
  accent: string;
  onToggle: () => void;
  onEdit: (v: string) => void;
  onCommit: () => void;
  onRemove: () => void;
}) {
  if (it.task_id) {
    return <LinkedTaskLine item={it} task={task} onUnlink={onRemove} accent={accent} />;
  }
  return (
    <div className="group/line flex items-start gap-2">
      <CheckDot checked={it.done} onToggle={onToggle} label={it.text} accent={accent} />
      <PinLineText value={it.text} done={it.done} onChange={onEdit} onCommit={onCommit} />
      <button
        onClick={onRemove}
        aria-label="Remove line"
        // Hover-revealed on desktop; always present on small screens,
        // where hover never fires and a line could not be removed.
        className="hidden shrink-0 text-subtle hover:text-danger group-hover/line:block max-md:block"
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
  // Uncoloured cards take the app accent for their ticks and progress, and no
  // tint: colour is an opt-in way to tell cards apart, not a requirement.
  const accent = areaColorVar(pin.color);
  const tint = areaTintBg(pin.color, 7);
  const badgeTint = areaTintBg(pin.color ?? "indigo", 18);
  const [editingTitle, setEditingTitle] = useState(false);
  // Open lines first, then the ticked ones folded under "N done". A shopping
  // list with half its lines struck through is mostly noise; the ticked lines
  // are still one click away.
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const openItems = items.filter((i) => !isItemDone(i));
  const doneItems = items.filter(isItemDone);
  const cap = compact || showAll ? Infinity : OPEN_LINES_SHOWN;
  const visibleOpen = openItems.slice(0, cap);
  const hiddenOpen = openItems.length - visibleOpen.length;
  // Titles are optional and take NO space when absent: show the input only when
  // there's a title or you're adding one; on the page an untitled pin offers a
  // subtle "+ title", on compact cards it shows nothing at all.
  const hasTitle = title.trim().length > 0;
  const showTitleInput = hasTitle || editingTitle;

  return (
    <div
      ref={cardRef}
      className={cn(
        // A soft wash of the card's colour instead of a coloured frame: the old
        // 3px border on every side of a tall card was what made the page read
        // as a stack of boxes rather than a set of notes.
        "group relative flex flex-col rounded-xl border border-border/70 bg-surface p-3 shadow-sm transition-shadow hover:shadow-md",
        // Masonry on the Cards page: CSS columns, so a card must not split.
        !compact && "mb-3 break-inside-avoid",
        drag && "select-none"
      )}
      style={{
        ...(tint ? { backgroundImage: `linear-gradient(${tint}, ${tint})` } : null),
        // A pin only spans columns where there IS a grid to span (the strip).
        ...(resize === "both" ? { gridColumn: `span ${span}` } : null),
        // minHeight, not height. A dragged size used to be a CEILING: anything
        // that did not fit was hidden behind a scrollbar inside the card, which
        // is the opposite of her ask ("I want to be able to see all the text all
        // the time"). It is now a floor, so the size you drag is "at least this
        // tall" and content is never cut off.
        //
        // This reverses a deliberate earlier choice (the min-h-0 below exists
        // precisely so a fixed-height pin could NOT be pushed taller by its own
        // content). The trade it makes: you can still drag a short card taller
        // to line it up with its neighbours, but you can no longer drag a card
        // shorter than the words inside it.
        ...(resize !== "none" && height ? { minHeight: height } : null),
      }}
    >
      {/* items-start so a title that wraps keeps its icon and menu beside the
          first line rather than centred against three. */}
      <div className="mb-2 flex shrink-0 items-start gap-2">
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md"
          style={{ background: badgeTint, color: accent }}
        >
          {pin.kind === "tracker" ? (
            <CadenceIcon className="h-3.5 w-3.5" />
          ) : pin.kind === "list" ? (
            <SubtaskIcon className="h-3.5 w-3.5" />
          ) : (
            <NotesIcon className="h-3.5 w-3.5" />
          )}
        </span>
        {showTitleInput ? (
          // A long title wraps rather than scrolling sideways out of view, for
          // the same reason the lines below it do.
          <textarea
            value={title}
            rows={1}
            autoFocus={editingTitle}
            ref={(el) => {
              if (!el) return;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
            onChange={(e) => {
              setTitle(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            onBlur={() => {
              setEditingTitle(false);
              if (title !== (pin.title ?? "")) update.mutate({ id: pin.id, body: { title } });
            }}
            placeholder="Title"
            className="mt-0.5 min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-sm font-semibold leading-snug text-foreground outline-none placeholder:text-subtle"
          />
        ) : compact ? (
          <span className="flex-1" />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            // Ghost until hover on desktop; small screens have no hover, so the
            // affordance stays faintly visible there or titles are unreachable.
            className="flex-1 text-left text-xs text-subtle opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 max-md:opacity-60"
          >
            + title
          </button>
        )}
        {pin.kind === "list" && items.length > 0 && (
          <span className="mt-1 shrink-0 text-[11px] tabular-nums text-subtle">
            {done}/{items.length}
          </span>
        )}
        {/* Tools appear on hover (always on touch screens, which have none), so
            a card at rest is its title and its content, not a toolbar. */}
        <div className="hidden shrink-0 items-center group-hover:flex max-md:flex has-[[data-state=open]]:flex">
          <TaskPicker tasks={allTasks} exclude={linkedIds} onPick={addTaskItem} />
          <ColorPicker
            color={pin.color}
            onPick={(c) => update.mutate({ id: pin.id, body: { color: c } })}
          />
          <PinMenu
            placement={pin.placement}
            // The full Cards-page card has the location chip for placement, so
            // the menu there only needs Delete. In situ (compact) it is the only
            // control, so it keeps the quick top/side/unpin toggles.
            showPlacement={!!compact}
            onSet={(p) => update.mutate({ id: pin.id, body: { placement: p } })}
            onDelete={() => del.mutate(pin.id)}
          />
        </div>
      </div>

      {/* Progress for a checklist: a thin bar reads faster than "3/10". */}
      {pin.kind === "list" && items.length > 0 && (
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${(done / items.length) * 100}%`, background: accent }}
          />
        </div>
      )}

      {/* Where this card shows, as one chip (scope + placement together). Only
          on the Cards page. It sits in the FOOTER now: it is a setting, not
          content, and at the top it pushed every card's content down a row. */}
      {!compact && (
        <div className="order-last mt-2 flex items-center">
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

      {/* The body grows with its content now that the card's dragged size is a
          minimum rather than a fixed height (see minHeight above). overflow-auto
          is kept as a backstop for a surface that genuinely constrains the card
          from outside; in the normal case there is nothing to scroll, because
          there is nothing hidden. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {pin.kind === "tracker" ? (
        // Scoped to the area it is pinned to, when it is pinned to one, so an
        // area's cadence card shows that area's gauges rather than all of them.
        <CadenceStrip
          areaId={pin.scope?.startsWith("area:") ? pin.scope.slice(5) : null}
          limit={compact ? 4 : 6}
        />
      ) : pin.kind === "list" ? (
        <div className="space-y-1">
          {visibleOpen.map((it) => (
            <ListLine
              key={it.id}
              it={it}
              task={it.task_id ? taskById.get(it.task_id) : undefined}
              accent={accent}
              onToggle={() => toggle(it.id)}
              onEdit={(v) => editItem(it.id, v)}
              onCommit={commitItem}
              onRemove={() => removeItem(it.id)}
            />
          ))}
          {hiddenOpen > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="pl-6 text-[12px] text-subtle transition-colors hover:text-foreground"
            >
              Show {hiddenOpen} more
            </button>
          )}
          <div className="flex items-center gap-2 pt-0.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <AddIcon className="h-4 w-4 shrink-0 text-subtle" />
            <input
              value={newLine}
              onChange={(e) => setNewLine(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLine()}
              onBlur={addLine}
              placeholder="Add an item"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
            />
          </div>
          {doneItems.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                aria-expanded={showDone}
                className="flex items-center gap-1 text-[12px] text-subtle transition-colors hover:text-foreground"
              >
                <ChevronRightIcon
                  className={cn("h-3.5 w-3.5 transition-transform", showDone && "rotate-90")}
                />
                {doneItems.length} done
              </button>
              {showDone && (
                <div className="mt-1 space-y-1">
                  {doneItems.map((it) => (
                    <ListLine
                      key={it.id}
                      it={it}
                      task={it.task_id ? taskById.get(it.task_id) : undefined}
                      accent={accent}
                      onToggle={() => toggle(it.id)}
                      onEdit={(v) => editItem(it.id, v)}
                      onCommit={commitItem}
                      onRemove={() => removeItem(it.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
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
              accent={accent}
            />
          ))}
        </div>
      )}
      </div>


      {/* Corner grip. Stays out of the way until you hover the pin. */}
      {resize !== "none" && (
        <div
          onPointerDown={onResizeDown}
          role="separator"
          aria-label="Resize card"
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
// A pin with nothing in it: no title, no text, no lines. Creating a new card
// sweeps these first, so walking away from a blank card never leaves litter.
const isEmptyPin = (p: Pin) =>
  p.kind !== "tracker" && !p.title && !p.body && (p.items ?? []).length === 0;

function useSweepEmpties() {
  const { data: pins = [] } = usePins();
  const del = useDeletePin();
  return () => pins.filter(isEmptyPin).forEach((p) => del.mutate(p.id));
}

export function useAddPin(scope: string) {
  const create = useCreatePin();
  const sweep = useSweepEmpties();
  const fresh = (body: Partial<Pin>) => {
    sweep();
    create.mutate(body);
  };
  return {
    addList: () => fresh({ kind: "list", placement: "top", scope }),
    addNote: () => fresh({ kind: "note", placement: "top", scope }),
    // A cadence card. Placed on the side, where a gauge you glance at belongs,
    // rather than in the top strip competing with the work itself.
    addTracker: () => fresh({ kind: "tracker", placement: "side", scope }),
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
  const sweepEmpties = useSweepEmpties();
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
    <div className="max-w-6xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <PinsIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Cards</h1>
        {pins.length > 0 && (
          <span className="text-xs text-subtle">
            {pins.length} card{pins.length === 1 ? "" : "s"}
            {loose.length > 0 && ` · ${loose.length} loose`}
          </span>
        )}
      </div>
      <PageIntro id="cards">
        Lists, reminders and gauges you keep beside your tasks. The chip on each
        card says where it shows; click it to pin the card to Today or an area,
        or keep it Loose (here only). Colour them to tell them apart; drag a
        pinned card&rsquo;s corner where it shows to resize it.
      </PageIntro>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* New pins start LOOSE (not on any page): the Pins page is where you
            keep lists, and putting one on Today/an area is a deliberate later
            step via "Show on". The area/view ... menus still create pins already
            attached to that page - there the placement is the whole point. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            sweepEmpties();
            create.mutate({ kind: "list", placement: "unpinned" });
          }}
        >
          <AddIcon className="h-4 w-4" /> New list
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            sweepEmpties();
            create.mutate({ kind: "note", placement: "unpinned" });
          }}
        >
          <AddIcon className="h-4 w-4" /> New text card
        </Button>

        {pins.length > 0 && (
          <div className="relative ml-auto">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search cards"
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
            No cards yet. A list is good for a running shopping list or conversation
            topics; a reminder is good for a goal or a quote you go by.
          </p>
        </div>
      ) : found.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface/40 p-4 text-center text-sm text-subtle">
          Nothing matches &ldquo;{q}&rdquo;.
        </p>
      ) : (
        // Masonry, loose cards first. A grid made every card in a row as tall as
        // the longest one, so a one-line quote sat in a box sized for a ten-item
        // list. Columns let each card be its own height. Each card carries its
        // own location chip, so no section headers are needed.
        <div className="gap-3 sm:columns-2 xl:columns-3">
          {visible.map((p) => (
            <PinCard key={p.id} pin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
