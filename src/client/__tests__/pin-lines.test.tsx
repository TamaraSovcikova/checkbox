// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PinLineText } from "../components/Pins";

// "I want to be able to see all the text all the time."
//
// A card's checklist lines were single-line <input> elements, which cannot wrap
// by definition: a long line scrolled sideways inside the field and the rest of
// it was simply not on screen, however wide or tall the card was made.

const LONG =
  "Ask the landlord for the deposit back, in writing, before the end of the month";

describe("PinLineText", () => {
  it("is a textarea, so the text can wrap instead of scrolling out of view", () => {
    render(
      <PinLineText value={LONG} done={false} onChange={() => {}} onCommit={() => {}} />
    );
    const el = screen.getByRole("textbox");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el).toHaveValue(LONG);
  });

  it("never shows a scrollbar of its own: the row grows to fit the words", () => {
    render(
      <PinLineText value={LONG} done={false} onChange={() => {}} onCommit={() => {}} />
    );
    expect(screen.getByRole("textbox").className).toContain("overflow-hidden");
    expect(screen.getByRole("textbox").className).toContain("resize-none");
  });

  it("reports edits as they are typed", () => {
    const seen: string[] = [];
    render(
      <PinLineText value="a" done={false} onChange={(v) => seen.push(v)} onCommit={() => {}} />
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ab" } });
    expect(seen).toEqual(["ab"]);
  });

  it("commits on blur", () => {
    let commits = 0;
    render(
      <PinLineText value="a" done={false} onChange={() => {}} onCommit={() => (commits += 1)} />
    );
    fireEvent.blur(screen.getByRole("textbox"));
    expect(commits).toBe(1);
  });

  it("Enter finishes the line rather than opening a second one", () => {
    // These are checklist lines. The wrapping is for long text, not paragraphs.
    let commits = 0;
    render(
      <PinLineText value="a" done={false} onChange={() => {}} onCommit={() => (commits += 1)} />
    );
    const el = screen.getByRole("textbox");
    fireEvent.keyDown(el, { key: "Enter" });
    fireEvent.blur(el);
    expect(commits).toBe(1);
  });

  it("strikes a done line through without hiding any of it", () => {
    render(
      <PinLineText value={LONG} done onChange={() => {}} onCommit={() => {}} />
    );
    const el = screen.getByRole("textbox");
    expect(el.className).toContain("line-through");
    expect(el.className).not.toContain("truncate");
  });
});
