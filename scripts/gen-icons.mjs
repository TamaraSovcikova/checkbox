#!/usr/bin/env node
// Generate the favicon / apple-touch / PWA icon set from the Checkbox mark:
// a rounded box whose tick breaks out through the top-right corner.
// Run: node scripts/gen-icons.mjs
//
// The geometry below mirrors src/client/components/LogoMark.tsx. Keep the two in
// sync: the component is what the app renders, this is what the OS renders.
// Rasterising the same SVG (via sharp) rather than hand-plotting pixels is what
// keeps them identical, and is why the arcs + round caps survive at 32px.
//
// App icons are a white mark on the brand indigo: a bare outline would disappear
// against a dark home screen. The favicon is the mark alone in indigo, so it
// reads on both light and dark browser chrome.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public");
fs.mkdirSync(OUT, { recursive: true });

const INDIGO = "#6366f1";
const BOX =
  "M15.5 3.5 H6.5 A3 3 0 0 0 3.5 6.5 V17.5 A3 3 0 0 0 6.5 20.5 H17.5 A3 3 0 0 0 20.5 17.5 V12.5";
const TICK = "M7.6 11.8 l3.4 3.4 L21.4 4";

// `pad` insets the 24-unit artboard: more padding means the mark sits further
// from the edge, which is what a maskable icon needs so the platform's mask
// (circle, squircle, ...) cannot clip it.
function markSvg({ size, colour, bg = null, pad = 0, radius = 0 }) {
  const min = -pad;
  const span = 24 + pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${min} ${min} ${span} ${span}">
  ${bg ? `<rect x="${min}" y="${min}" width="${span}" height="${span}" rx="${radius}" fill="${bg}"/>` : ""}
  <g fill="none" stroke="${colour}" stroke-linecap="round" stroke-linejoin="round">
    <path d="${BOX}" stroke-width="1.9"/>
    <path d="${TICK}" stroke-width="2.3"/>
  </g>
</svg>`;
}

const write = (svg, file) =>
  sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(OUT, file))
    .then(() => console.log("wrote", file));

await Promise.all([
  // Favicon: bare mark, transparent background, indigo stroke.
  write(markSvg({ size: 32, colour: INDIGO, pad: 1 }), "favicon-32.png"),

  // Home screen / PWA "any": white mark on indigo. iOS rounds the corners of
  // apple-touch-icon itself, so a full-bleed tile is correct there.
  write(
    markSvg({ size: 180, colour: "#ffffff", bg: INDIGO, pad: 4 }),
    "apple-touch-icon.png"
  ),
  write(markSvg({ size: 192, colour: "#ffffff", bg: INDIGO, pad: 4 }), "icon-192.png"),
  write(markSvg({ size: 512, colour: "#ffffff", bg: INDIGO, pad: 4 }), "icon-512.png"),

  // Maskable: extra padding keeps the mark inside the ~80% safe zone.
  write(
    markSvg({ size: 512, colour: "#ffffff", bg: INDIGO, pad: 9 }),
    "icon-maskable-512.png"
  ),
]);
