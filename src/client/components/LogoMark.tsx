// The Checkbox mark: a rounded box whose tick breaks out through the top-right
// corner. The box opens where the tick leaves, so the two read as one gesture
// rather than a tick sitting on top of a square.
//
// Drawn with currentColor and no fill, so it inherits whichever colour scheme is
// active (see lib/theme.ts) and works on any surface. Geometry is tuned for small
// sizes: the 20px sidebar rendering is the one that matters most, so the strokes
// stay chunky and the box corner gap is wide enough not to fill in.
//
// scripts/gen-icons.mjs rasterises the same geometry into the favicon / PWA
// icons. Keep the two paths in sync if this ever changes.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* Box, open at the top-right where the tick escapes. */}
      <path d="M15.5 3.5 H6.5 A3 3 0 0 0 3.5 6.5 V17.5 A3 3 0 0 0 6.5 20.5 H17.5 A3 3 0 0 0 20.5 17.5 V12.5" />
      {/* Tick, carrying on past the corner. */}
      <path d="M7.6 11.8 l3.4 3.4 L21.4 4" strokeWidth={2.3} />
    </svg>
  );
}
