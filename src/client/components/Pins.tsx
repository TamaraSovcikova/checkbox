import { useEffect, useState } from "react";
import type { Pin, PinItem } from "../../shared/types";
import { usePins, useCreatePin, useUpdatePin, useDeletePin } from "../lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  PinIcon,
  PinsIcon,
  TrashIcon,
  AddIcon,
  NotesIcon,
  SubtaskIcon,
} from "../lib/icons";

const newItem = (text: string): PinItem => ({
  id: crypto.randomUUID(),
  text,
  done: false,
});

// One pin: a living checklist ('list') or a standing reminder ('note'). Used
// both on the Pins page (full) and in the Today strip (compact). Item edits keep
// local state for instant feedback and PATCH the whole items array behind it.
function PinCard({ pin, compact }: { pin: Pin; compact?: boolean }) {
  const update = useUpdatePin();
  const del = useDeletePin();
  const [title, setTitle] = useState(pin.title ?? "");
  const [items, setItems] = useState<PinItem[]>(pin.items ?? []);
  const [body, setBody] = useState(pin.body ?? "");
  const [editingBody, setEditingBody] = useState(false);
  const [newLine, setNewLine] = useState("");

  // Re-sync when a refetch brings a newer version.
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

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface p-3",
        compact && "bg-surface/60"
      )}
    >
      {/* Header: title + pin-to-today toggle + delete */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-subtle">
          {pin.kind === "list" ? (
            <SubtaskIcon className="h-3.5 w-3.5" />
          ) : (
            <NotesIcon className="h-3.5 w-3.5" />
          )}
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== (pin.title ?? "") && update.mutate({ id: pin.id, body: { title } })}
          placeholder={pin.kind === "list" ? "List title" : "Reminder title"}
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-subtle"
        />
        {pin.kind === "list" && items.length > 0 && (
          <span className="shrink-0 text-[11px] text-subtle">
            {done}/{items.length}
          </span>
        )}
        <button
          onClick={() =>
            update.mutate({ id: pin.id, body: { pinned_today: pin.pinned_today ? 0 : 1 } })
          }
          title={pin.pinned_today ? "Unpin from Today" : "Keep on Today"}
          aria-label={pin.pinned_today ? "Unpin from Today" : "Keep on Today"}
          className={cn(
            "grid h-6 w-6 shrink-0 place-items-center rounded transition-colors",
            pin.pinned_today
              ? "text-primary hover:bg-primary/10"
              : "text-subtle hover:bg-surface-2 hover:text-foreground"
          )}
        >
          <PinIcon className="h-3.5 w-3.5" />
        </button>
        {!compact && (
          <button
            onClick={() => del.mutate(pin.id)}
            title="Delete pin"
            aria-label="Delete pin"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:bg-danger/10 hover:text-danger"
          >
            <TrashIcon className="h-3.5 w-3.5" />
          </button>
        )}
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

// The always-visible strip at the top of Today: pins the user chose to keep on
// their eyes. Renders nothing when none are pinned.
export function PinsStrip() {
  const { data: pins = [] } = usePins();
  const pinned = pins.filter((p) => p.pinned_today);
  if (pinned.length === 0) return null;
  return (
    <div className="mb-4 grid max-w-2xl gap-2 sm:grid-cols-2">
      {pinned.map((p) => (
        <PinCard key={p.id} pin={p} compact />
      ))}
    </div>
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
        Lists you edit day to day and reminders you want on your eyes — kept beside
        your tasks, never mixed in. Toggle the pin icon to keep one on Today.
      </p>

      <div className="mb-4 flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "list", title: "" })}
        >
          <AddIcon className="h-4 w-4" /> New list
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => create.mutate({ kind: "note", title: "" })}
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
