import { useEffect, useState } from "react";
import type { Pin, PinItem } from "../../shared/types";
import { usePins, useCreatePin, useUpdatePin, useDeletePin } from "../lib/queries";
import { AREA_COLORS, areaColorVar } from "../lib/colors";
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

// One pin: a living checklist ('list') or a standing reminder ('note'). Used on
// the Pins page (full) and in the Today strip / side column (compact).
function PinCard({ pin, compact }: { pin: Pin; compact?: boolean }) {
  const update = useUpdatePin();
  const del = useDeletePin();
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
      className={cn("group rounded-lg border bg-surface p-3", compact && "bg-surface/60")}
      style={
        accent
          ? { borderLeftColor: accent, borderLeftWidth: 3 }
          : { borderColor: "var(--border)" }
      }
    >
      <div className="mb-1.5 flex items-center gap-2">
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
          onChange={(e) => setBody(e.target.value)}
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
  );
}

// Full-width strip at the top of Today: pins placed 'top'.
export function PinsStrip() {
  const { data: pins = [] } = usePins();
  const top = pins.filter((p) => p.placement === "top");
  if (top.length === 0) return null;
  return (
    <div className="mb-4 grid max-w-2xl gap-2 sm:grid-cols-2">
      {top.map((p) => (
        <PinCard key={p.id} pin={p} compact />
      ))}
    </div>
  );
}

// Narrow right column on Today: pins placed 'side'.
export function PinsSide() {
  const { data: pins = [] } = usePins();
  const side = pins.filter((p) => p.placement === "side");
  if (side.length === 0) return null;
  return (
    <aside className="mt-4 space-y-2 lg:mt-0 lg:w-64 lg:shrink-0">
      {side.map((p) => (
        <PinCard key={p.id} pin={p} compact />
      ))}
    </aside>
  );
}

// The Pins management page (sidebar → Pins).
export function PinsPage() {
  const { data: pins = [] } = usePins();
  const create = useCreatePin();

  return (
    <div className="max-w-2xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <PinsIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">Pins</h1>
      </div>
      <p className="mb-4 text-sm text-subtle">
        Lists you edit day to day and reminders you want on your eyes, kept beside
        your tasks. Use the Top / Side toggle to place each one on your Today page,
        and colour them so they stand apart.
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
        <div className="space-y-2">
          {pins.map((p) => (
            <PinCard key={p.id} pin={p} />
          ))}
        </div>
      )}
    </div>
  );
}
