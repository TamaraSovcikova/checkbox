import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MoreIcon, SortIcon, GroupIcon, ICON_SIZE } from "../lib/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
} from "./ui/dropdown-menu";

// The solid, non-overlapping top bar shared by every view (replaces the old
// semi-transparent ViewToolbar). Wired per-view in T5.
export type Tab<T extends string = string> = {
  id: T;
  label: string;
  icon: ReactNode;
};

export type MenuChoice = {
  label: string;
  active?: boolean;
  onSelect: () => void;
};

export function TopBar<T extends string>({
  title,
  icon,
  tabs,
  activeTab,
  onTab,
  sort,
  group,
  menu,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  tabs?: Tab<T>[];
  activeTab?: T;
  onTab?: (id: T) => void;
  sort?: MenuChoice[];
  group?: MenuChoice[];
  menu?: MenuChoice[];
  actions?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-border bg-background px-6 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="shrink-0 text-primary">{icon}</span>}
        <h1 className="truncate text-xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        {menu && menu.length > 0 && (
          <ChoiceMenu
            align="start"
            trigger={
              <button
                type="button"
                aria-label="More"
                className="grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2"
              >
                <MoreIcon className={ICON_SIZE} />
              </button>
            }
            items={menu}
          />
        )}
      </div>

      {tabs && tabs.length > 0 && activeTab != null && onTab && (
        <nav className="flex items-center gap-1">
          {tabs.map((t) => {
            const on = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTab(t.id)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition-colors",
                  on ? "text-primary" : "text-muted hover:text-foreground"
                )}
              >
                <span>{t.icon}</span>
                {t.label}
                {on && (
                  <span className="absolute inset-x-2 -bottom-3 h-0.5 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </nav>
      )}

      <div className="ml-auto flex items-center gap-1">
        {sort && sort.length > 0 && (
          <LabeledMenu
            icon={<SortIcon className={ICON_SIZE} />}
            label="Sort"
            items={sort}
          />
        )}
        {group && group.length > 0 && (
          <LabeledMenu
            icon={<GroupIcon className={ICON_SIZE} />}
            label="Group"
            items={group}
          />
        )}
        {actions}
      </div>
    </header>
  );
}

function LabeledMenu({
  icon,
  label,
  items,
}: {
  icon: ReactNode;
  label: string;
  items: MenuChoice[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground data-[state=open]:bg-surface-2 data-[state=open]:text-foreground"
        >
          <span>{icon}</span>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((it) => (
          <DropdownMenuCheckboxItem
            key={it.label}
            checked={!!it.active}
            onSelect={it.onSelect}
          >
            {it.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChoiceMenu({
  trigger,
  items,
  align = "end",
}: {
  trigger: ReactNode;
  items: MenuChoice[];
  align?: "start" | "end";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map((it) => (
          <DropdownMenuItem key={it.label} onSelect={it.onSelect}>
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
