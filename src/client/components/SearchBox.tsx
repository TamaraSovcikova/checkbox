import { SearchIcon } from "../lib/icons";

// Opens the command palette in search mode. The palette (CommandCapture) already
// runs the /tasks/search query against everything typed; this is just the
// visible, discoverable entry point, since a Cmd-K hotkey is not discoverable.
function openSearch() {
  window.dispatchEvent(new Event("checkbox:search"));
}

// Full-width faux-input for the sidebar. Looks like a search field, is really a
// button that opens the palette (the pattern Linear/GitHub/Notion all use).
export function SearchBox() {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={openSearch}
      className="mb-3 flex w-full items-center gap-2 rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-subtle transition-colors hover:border-primary/50 hover:text-foreground"
    >
      <SearchIcon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Search tasks</span>
      <kbd className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted md:inline">
        {isMac ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

// Icon-only trigger for the mobile top bar, where horizontal space is scarce.
export function SearchIconButton() {
  return (
    <button
      type="button"
      aria-label="Search tasks"
      onClick={openSearch}
      className="grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
    >
      <SearchIcon className="h-5 w-5" />
    </button>
  );
}
