import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Pin, PinItem } from "../../shared/types";
import {
  usePins,
  useCreatePin,
  useUpdatePin,
  useDeletePin,
  useAreas,
} from "../lib/queries";
import { AREA_COLORS, areaColorVar } from "../lib/colors";
import { pinsForScope, scopeLabel, scopeOptions } from "../lib/pinScope";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";
import {
  PinsIcon,
  TrashIcon,
  AddIcon,
  NotesIcon,
  SubtaskIcon,
  MoreIcon,
} from "../lib/icons";

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
  onSet,
  onDelete,
}: {
  placement: Placement;
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
        <DropdownMenuCheckboxItem
          checked={placement === "top"}
          onSelect={() => onSet(placement === "top" ? "unpinned" : "top")}
        >
          Show at top of Today
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={placement === "side"}
          onSelect={() => onSet(placement === "side" ? "unpinned" : "side")}
        >
          Show in Today side column
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem className="text-danger" onSelect={onDelete}>
          Delete pin
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [title, setTitle] = useState(pin.title ?? "");
  const [items, setItems] = useState<PinItem[]>(pin.items ?? []);
  const [body, setBody] = useState(pin.body ?? "");
  const [editingBody, setEditingBody] = useState(false);
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

  const done = items.filter((i) => i.done).length;
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
          {pin.kind === "list" ? (
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
        <ColorPicker
          color={pin.color}
          onPick={(c) => update.mutate({ id: pin.id, body: { color: c } })}
        />
        <PinMenu
          placement={pin.placement}
          onSet={(p) => update.mutate({ id: pin.id, body: { placement: p } })}
          onDelete={() => del.mutate(pin.id)}
        />
      </div>

      {/* min-h-0 so this can actually shrink inside the flex column: without it
          a fixed-height pin would be pushed taller by its own content. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
      {pin.kind === "list" ? (
        <div className="space-y-0.5">
          {items.map((it) => (
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
          ))}
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
      ) : editingBody || !body.trim() ? (
        <textarea
          value={body}
          autoFocus={editingBody}
          onFocus={() => setEditingBody(true)}
          // Mark editing in the SAME change as the keystroke: the first character
          // makes body non-empty, which would otherwise flip this back to the
          // preview and yank focus (the same trap the task notes had).
          onChange={(e) => {
            setBody(e.target.value);
            setEditingBody(true);
          }}
          onBlur={() => {
            setEditingBody(false);
            if (body !== (pin.body ?? "")) update.mutate({ id: pin.id, body: { body } });
          }}
          placeholder="Your reminder, goal or quote…"
          rows={compact ? 2 : 3}
          className="w-full resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-subtle"
        />
      ) : (
        <button
          onClick={() => setEditingBody(true)}
          className="w-full whitespace-pre-wrap text-left text-[13px] text-foreground"
          title="Click to edit"
        >
          {body}
        </button>
      )}
      </div>

      {/* Which page this pin lives on. Only on the Pins page (full card): that is
          where you organise, and it would be noise on the pin itself in situ. */}
      {!compact && (
        <label className="mt-2 flex items-center gap-2 border-t border-border pt-2 text-[11px] text-subtle">
          <span className="shrink-0">Show on</span>
          <select
            value={pin.scope || "today"}
            onChange={(e) => update.mutate({ id: pin.id, body: { scope: e.target.value } })}
            className="h-7 min-w-0 flex-1 rounded border border-input bg-surface px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
          >
            {scopeOptions(areas).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
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
export function PinsSide({ scope = "today" }: { scope?: string }) {
  const { data: pins = [] } = usePins();
  const side = pinsForScope(pins, scope).filter((p) => p.placement === "side");
  if (side.length === 0) return null;
  return (
    <aside className="mt-4 space-y-2 lg:mt-0 lg:w-64 lg:shrink-0">
      {side.map((p) => (
        <PinCard key={p.id} pin={p} compact resize="height" />
      ))}
    </aside>
  );
}

// The Pins management page (sidebar → Pins).
export function PinsPage() {
  const { data: pins = [] } = usePins();
  const { data: areas = [] } = useAreas();
  const create = useCreatePin();

  // Group by scope, in the picker's order, so the page always lists pages in the
  // same sequence rather than jumping around as pins move.
  const order = scopeOptions(areas).map((o) => o.value);
  const groups = [...new Set(pins.map((p) => p.scope || "today"))]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      // A scope we do not recognise (e.g. a deleted area) sorts last.
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    })
    .map((scope) => ({
      scope,
      label: scopeLabel(scope, areas),
      pins: pins.filter((p) => (p.scope || "today") === scope),
    }));

  return (
    <div className="max-w-2xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <PinsIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Pins</h1>
      </div>
      <p className="mb-4 text-sm text-subtle">
        Lists you edit day to day and reminders you want on your eyes, kept beside
        your tasks. &ldquo;Show on&rdquo; picks the page a pin lives on (Today, a view, or
        an area); the Top / Side toggle picks where on that page; colour them so
        they stand apart.
      </p>

      <div className="mb-4 flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "list", placement: "top" })}
        >
          <AddIcon className="h-4 w-4" /> New list
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "note", placement: "top" })}
        >
          <AddIcon className="h-4 w-4" /> New reminder
        </Button>
      </div>

      {pins.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/40 p-6 text-center">
          <PinsIcon className="mx-auto mb-2 h-6 w-6 text-subtle" />
          <p className="text-sm text-subtle">
            No pins yet. A list is good for a running shopping list or conversation
            topics; a reminder is good for a goal or a quote you go by.
          </p>
        </div>
      ) : (
        // Grouped by the page each pin lives on, so this reads as "what is on
        // Today, what is on Health" rather than one undifferentiated pile.
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.scope}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                {g.label}
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-normal tabular-nums text-muted">
                  {g.pins.length}
                </span>
              </h2>
              <div className="space-y-2">
                {g.pins.map((p) => (
                  <PinCard key={p.id} pin={p} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
