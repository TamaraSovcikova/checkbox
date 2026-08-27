// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Hint } from "../components/ui/hint";

// The phone is this app's main surface and it has no hover, so a tooltip that
// only answers to a mouse does not exist there. The first cut toggled on click
// AND opened on focus, so a tap opened it (focus) and immediately closed it
// (toggle): net effect, nothing, on the one surface that needed it most.

const setup = () =>
  render(<Hint text="Runs on a schedule.">Repeat</Hint>);

describe("Hint", () => {
  it("shows on hover and hides when the pointer leaves", () => {
    setup();
    const trigger = screen.getByRole("button");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Runs on a schedule.");
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("STAYS OPEN when tapped, which is the only way to read it on a phone", () => {
    setup();
    const trigger = screen.getByRole("button");
    // What a tap actually fires, in order.
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens on keyboard focus and closes on blur", () => {
    setup();
    const trigger = screen.getByRole("button");
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("carries the text for screen readers as well as eyes", () => {
    setup();
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Runs on a schedule."
    );
  });
});
