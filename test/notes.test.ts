import { describe, it, expect } from "vitest";
import { extractNoteTasks, candidateKey } from "../src/shared/notes";

describe("extractNoteTasks", () => {
  it("extracts unchecked checkboxes and skips checked ones", () => {
    const text = [
      "# Monday",
      "- [ ] Email the accountant",
      "- [x] Already done thing",
      "* [ ] Star-bullet task",
      "+ [ ] Plus-bullet task",
    ].join("\n");
    const out = extractNoteTasks(text);
    expect(out.map((t) => t.title)).toEqual([
      "Email the accountant",
      "Star-bullet task",
      "Plus-bullet task",
    ]);
    expect(out.every((t) => t.kind === "checkbox")).toBe(true);
  });

  it("records 1-indexed line numbers", () => {
    const text = "intro\nmore\n- [ ] Third line task";
    const [task] = extractNoteTasks(text);
    expect(task.line).toBe(3);
  });

  it("picks up TODO and FIXME markers", () => {
    const out = extractNoteTasks("TODO: buy milk\n- FIXME broken build\nnormal text");
    expect(out.map((t) => t.title)).toEqual(["buy milk", "broken build"]);
    expect(out.every((t) => t.kind === "todo")).toBe(true);
  });

  it("cleans markdown links, wikilinks and formatting from titles", () => {
    const out = extractNoteTasks(
      "- [ ] Reply to [Sam](mailto:sam@x.com) about **the deck**\n- [ ] Review [[Project Aura|Aura]]"
    );
    expect(out[0].title).toBe("Reply to Sam about the deck");
    expect(out[1].title).toBe("Review Aura");
  });

  it("ignores plain lines and empty checkboxes", () => {
    expect(extractNoteTasks("just a paragraph\n- [ ]   \n- a normal bullet")).toEqual([]);
  });

  it("builds a stable, case-insensitive dedupe key", () => {
    expect(candidateKey("Daily/x.md", 3, "Email Sam")).toBe(
      candidateKey("Daily/x.md", 3, "email sam")
    );
    expect(candidateKey("Daily/x.md", 3, "Email Sam")).not.toBe(
      candidateKey("Daily/x.md", 4, "Email Sam")
    );
  });
});
