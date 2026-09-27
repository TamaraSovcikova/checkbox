// Lists and boards select the same way and look the same when selected.
//
// Both always ran on useTaskSelection, but each drew its own select box and its
// own "selected" style, and they drifted. These pin that every task surface
// with selection uses the shared SelectMark and SELECTED_STYLE and does not grow
// a private copy again.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (f: string) =>
  readFileSync(join(__dirname, "..", "src", "client", "components", f), "utf8");

const SURFACES = ["TaskRow.tsx", "ProjectBoard.tsx"];

describe("one selection look", () => {
  for (const f of SURFACES) {
    it(`${f} uses the shared select box and selected style`, () => {
      const text = src(f);
      expect(text).toContain("<SelectMark");
      expect(text).toContain("SELECTED_STYLE");
    });

    it(`${f} has no select box of its own`, () => {
      // A private copy would be a checkbox-role button wired to onToggle.
      expect(src(f)).not.toMatch(/selection\.onToggle\(\)/);
    });
  }

  it("the select box is not offered on hover on desktop", () => {
    const text = src("TaskListControls.tsx");
    const mark = text.slice(text.indexOf("export function SelectMark"), text.indexOf("// Floating action bar"));
    expect(mark).not.toContain("group-hover");
    expect(mark).toContain("max-md:grid"); // touch screens still get it
  });
});
