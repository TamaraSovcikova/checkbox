import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// A plain tooltip, above the thing it explains.
//
// The native `title=` attribute was doing this job and doing it badly: it waits
// a second, appears at the POINTER rather than at the label, wraps a long string
// into an unreadable block, and never appears at all on a phone. Her verdict on
// the first cut was that the text was far too long and the question-mark cursor
// was odd; both were symptoms of leaning on `title`.
//
// So: a small bubble, above, on hover OR focus, and the trigger is a real button
// so a thumb can reach it. Deliberately not a dependency (@radix-ui/react-tooltip
// is not installed and this needs none of it) and deliberately not dismissable
// clutter: it holds one short sentence, or it is the wrong control.
export function Hint({
  children,
  text,
  className,
}: {
  children: ReactNode;
  // One sentence. If it needs two, the thing being explained needs a rethink.
  text: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        // The bubble is the whole point, so it opens on the ways a bubble can be
        // asked for: hover with a mouse, tab with a keyboard, tap on a phone.
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        aria-label={text}
        className={cn(
          "inline-flex items-center gap-1.5 rounded outline-none",
          // Dotted underline, no cursor change: the underline already says
          // "there is more here" without borrowing a cursor from a help file.
          "underline decoration-dotted decoration-from-font underline-offset-2",
          className
        )}
      >
        {children}
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-max max-w-[16rem] rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] font-normal leading-snug text-foreground shadow-lg shadow-black/30"
        >
          {text}
        </span>
      )}
    </span>
  );
}
