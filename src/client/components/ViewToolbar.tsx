import type { ReactNode } from "react";

// The functional bar pinned to the top of every view. Title/subtitle on the
// left, action controls on the right (passed in per view).
export function ViewToolbar({
  title,
  sub,
  icon,
  actions,
}: {
  title: string;
  sub?: string;
  icon?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 flex items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
      {icon && <span className="text-lg leading-none">{icon}</span>}
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
        {sub && <p className="truncate text-xs text-slate-500">{sub}</p>}
      </div>
      {actions && (
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      )}
    </div>
  );
}

// A small icon button for toolbar actions (hide view, sort, filter, etc.).
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
      className={
        "grid h-8 w-8 place-items-center rounded-md text-sm transition-colors " +
        (active
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100")
      }
    >
      {children}
    </button>
  );
}
