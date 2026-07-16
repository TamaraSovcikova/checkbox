import { useMemo, useRef, useState } from "react";
import { parseCapture, previewChips, activeCaptureToken } from "../lib/nlp";
import type { CaptureParse } from "../../shared/types";
import { useCreateTask, useProjects, useAreas, useLabels } from "../lib/queries";
import { Input } from "./ui";

const CHIP_STYLE: Record<string, string> = {
  date: "bg-surface-2 text-muted",
  priority: "bg-surface-2 text-muted",
  recurrence: "bg-surface-2 text-muted",
  label: "bg-surface-2 text-muted",
  project: "bg-surface-2 text-muted",
};

type Suggestion = { id: string; name: string; kind: "label" | "area" | "project" };

// Rank suggestions: exact/prefix matches first, then substring, then alpha.
// An empty query returns everything (sorted), so bare "@" or "#" lists all.
function rank(items: Suggestion[], q: string): Suggestion[] {
  const filtered = q
    ? items.filter((i) => i.name.toLowerCase().includes(q))
    : items.slice();
  return filtered
    .sort((a, b) => {
      const ap = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bp = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return ap - bp || a.name.localeCompare(b.name);
    })
    .slice(0, 6);
}

// Apply a dismissed date: drop the due date and put the matched words back in
// the title, so nothing the user typed is lost.
function withDateDismissed(p: CaptureParse): CaptureParse {
  return { ...p, title: p.titleWithDate, due_date: null, due_time: null, dateText: null };
}

export function QuickCapture({
  defaultAreaId,
  defaultProjectId,
  defaultPlannedDate,
}: {
  defaultAreaId?: string | null;
  defaultProjectId?: string | null;
  // Capturing while on Today should land the task in Today, not silently in the
  // Backlog. planned_date does that without inventing a due date.
  defaultPlannedDate?: string | null;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [dateDismissed, setDateDismissed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const create = useCreateTask();
  const { data: projects = [] } = useProjects();
  const { data: areas = [] } = useAreas();
  const { data: labels = [] } = useLabels();

  // Known category names (areas + projects) let the parser resolve multi-word
  // "#Health & Home" tokens instead of grabbing a single word.
  const categoryNames = useMemo(
    () => [...areas.map((a) => a.name), ...projects.map((p) => p.name)],
    [areas, projects]
  );

  const raw = useMemo(() => parseCapture(text, categoryNames), [text, categoryNames]);
  const parsed = dateDismissed ? withDateDismissed(raw) : raw;
  const chips = previewChips(parsed);

  // Type-ahead: the token the caret is in, and the matching suggestions.
  const token = useMemo(
    () => activeCaptureToken(text, caret, categoryNames),
    [text, caret, categoryNames]
  );
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token) return [];
    const q = token.query.trim().toLowerCase();
    if (token.trigger === "@")
      return rank(
        labels.map((l) => ({ id: l.id, name: l.name, kind: "label" as const })),
        q
      );
    return rank(
      [
        ...areas.map((a) => ({ id: a.id, name: a.name, kind: "area" as const })),
        ...projects.map((p) => ({ id: p.id, name: p.name, kind: "project" as const })),
      ],
      q
    );
  }, [token, labels, areas, projects]);

  const menuOpen = suggestions.length > 0 && !menuDismissed;
  const idx = Math.min(activeIdx, suggestions.length - 1);

  function syncCaret(el: HTMLInputElement) {
    setCaret(el.selectionStart ?? el.value.length);
  }

  // Replace the active token's text with the chosen name + a trailing space.
  function accept(s: Suggestion) {
    if (!token) return;
    const before = text.slice(0, token.start);
    const after = text.slice(caret);
    const insert = token.trigger + s.name + " ";
    const next = before + insert + after;
    const nextCaret = (before + insert).length;
    setText(next);
    setCaret(nextCaret); // sync, so the token re-derives and the menu closes now
    setDateDismissed(false);
    setMenuDismissed(false);
    setActiveIdx(0);
    // Restore focus + DOM caret after React paints the new value.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
      }
    });
  }

  function submit() {
    const title = parsed.title.trim();
    if (!title) return;

    // Resolve #category to an existing project or area by name. A project match
    // also carries its area, so the task lands in the right place; an area match
    // files the task straight under that area.
    let project_id = defaultProjectId ?? null;
    let area_id = defaultAreaId ?? null;
    if (parsed.projectName) {
      const q = parsed.projectName.toLowerCase();
      const proj = projects.find((p) => p.name.toLowerCase() === q);
      if (proj) {
        project_id = proj.id;
        area_id = proj.area_id;
      } else {
        const area = areas.find((a) => a.name.toLowerCase() === q);
        if (area) {
          area_id = area.id;
          project_id = null;
        }
      }
    }

    create.mutate({
      title,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      priority: parsed.priority ?? 4,
      labelNames: parsed.labelNames,
      recurrence: parsed.recurrence,
      area_id,
      project_id,
      planned_date: defaultPlannedDate ?? null,
    });
    setText("");
    setCaret(0);
    setDateDismissed(false);
    setMenuDismissed(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (Math.min(i, suggestions.length - 1) + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx(
          (i) => (Math.min(i, suggestions.length - 1) - 1 + suggestions.length) % suggestions.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(suggestions[idx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (e.key === "Enter") submit();
  }

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            syncCaret(e.target);
            setDateDismissed(false); // a new keystroke is a fresh parse + decision
            setMenuDismissed(false); // typing re-opens the menu
            setActiveIdx(0);
          }}
          onKeyUp={(e) => syncCaret(e.currentTarget)}
          onClick={(e) => syncCaret(e.currentTarget)}
          onKeyDown={onKeyDown}
          onBlur={() => setMenuDismissed(true)}
          placeholder="Add a task... e.g. Call landlord tomorrow 3pm p2 @call #Belgium"
        />
        {menuOpen && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-auto rounded-md border border-input bg-surface py-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={`${s.kind}:${s.id}`} role="option" aria-selected={i === idx}>
                <button
                  type="button"
                  // mousedown fires before the input's blur, so the pick lands.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(s);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                    i === idx ? "bg-surface-2" : ""
                  }`}
                >
                  <span className="text-subtle">{token?.trigger}</span>
                  <span className="flex-1 truncate text-foreground">{s.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-subtle">
                    {s.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {chips.map((ch, i) =>
            // The date chip is removable: one click drops a wrong guess and
            // returns the words to the title.
            ch.kind === "date" ? (
              <button
                key={i}
                type="button"
                onClick={() => setDateDismissed(true)}
                title="Not a date? Click to remove"
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_STYLE[ch.kind]} hover:text-danger`}
              >
                {ch.label}
                <span aria-hidden>×</span>
              </button>
            ) : (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${CHIP_STYLE[ch.kind]}`}
              >
                {ch.label}
              </span>
            )
          )}
          <span className="self-center text-[11px] text-subtle">
            press Enter to add
          </span>
        </div>
      )}
    </div>
  );
}
