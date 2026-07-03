import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./ui";

// ── Icons (Lucide-style, 16px 1.75 stroke) ───────────────────────────────────

const svg = "h-[18px] w-[18px]";

export function IconListDots() {
  return (
    <svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconGrid() {
  return (
    <svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconList() {
  return (
    <svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}

export function IconSort() {
  return (
    <svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M7 4l-3 3M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3" />
    </svg>
  );
}

export function IconGroup() {
  return (
    <svg className={svg} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

function IconDots() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

// ── The bar pinned to the top of every view ───────────────────────────────────

export type Tab<T extends string = string> = {
  id: T;
  label: string;
  icon: ReactNode;
};

export function ViewToolbar<T extends string>({
  title,
  sub,
  icon,
  tabs,
  activeTab,
  onTab,
  menu,
  actions,
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  tabs?: Tab<T>[];
  activeTab?: T;
  onTab?: (id: T) => void;
  menu?: MenuItem[];
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 flex items-center gap-4 border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
      {/* Title cluster */}
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="shrink-0 text-sky-400">{icon ?? <IconListDots />}</span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
        </div>
        {menu && menu.length > 0 && (
          <ToolbarMenu icon={<IconDots />} align="left" items={menu} />
        )}
      </div>

      {/* View switcher tabs */}
      {tabs && tabs.length > 0 && activeTab != null && onTab && (
        <ViewTabs tabs={tabs} active={activeTab} onChange={onTab} />
      )}

      {/* Right-aligned actions */}
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  );
}

function ViewTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cx(
              "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition-colors",
              on ? "text-sky-400" : "text-slate-400 hover:text-slate-200"
            )}
          >
            <span>{t.icon}</span>
            {t.label}
            {on && (
              <span className="absolute inset-x-2 -bottom-3 h-0.5 rounded-full bg-sky-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Dropdown menu (used for Sort, Group, and the ··· more menu) ────────────────

export type MenuItem = {
  label: string;
  active?: boolean;
  onClick: () => void;
};

export function ToolbarMenu({
  icon,
  label,
  items,
  align = "right",
}: {
  icon: ReactNode;
  label?: string;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          open
            ? "bg-slate-800 text-slate-100"
            : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
        )}
      >
        <span>{icon}</span>
        {label && <span>{label}</span>}
      </button>
      {open && (
        <div
          className={cx(
            "absolute z-20 mt-1 min-w-44 rounded-lg border border-slate-800 bg-slate-900 p-1 shadow-xl shadow-black/40",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                it.onClick();
                setOpen(false);
              }}
              className={cx(
                "flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-slate-800",
                it.active ? "text-sky-400" : "text-slate-200"
              )}
            >
              {it.label}
              {it.active && <span className="text-sky-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// A small icon-only button for one-off toolbar actions (kept for back-compat).
export function ToolbarButton({
  title,
  onClick,
  children,
  active,
}: {
  title: string;
  onClick?: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        "grid h-8 w-8 place-items-center rounded-md text-sm transition-colors",
        active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
      )}
    >
      {children}
    </button>
  );
}
