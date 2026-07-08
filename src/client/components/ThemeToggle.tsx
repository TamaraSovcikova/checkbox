import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "../lib/theme";

// Quick one-tap toggle for the header. Flips between light and dark based on the
// currently-resolved mode (so it does the visually-obvious thing even when the
// pref is "system"). The full System/Light/Dark control lives in Settings.
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPref } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setPref(next)}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground",
        className
      )}
    >
      {resolved === "dark" ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
    </button>
  );
}
