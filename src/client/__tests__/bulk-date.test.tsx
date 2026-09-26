// @vitest-environment happy-dom
// Issue #1: the bulk bar can give a whole selection ANY date, as a plan, a
// deadline or a snooze, typed in words or picked. Each mode must call the
// action that writes its own field and nothing else.
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BulkDateButton } from "../components/TaskListControls";

const TODAY = "2026-09-26";

function setup() {
  const controls = {
    count: 3,
    planSelected: vi.fn(),
    scheduleSelected: vi.fn(),
    snoozeSelected: vi.fn(),
    bulkUpdate: vi.fn(),
  };
  render(<BulkDateButton controls={controls as any} today={TODAY} />);
  fireEvent.click(screen.getByRole("button", { name: /date/i }));
  return controls;
}

function typeDate(text: string) {
  const box = screen.getByLabelText("Type a date");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

describe("BulkDateButton", () => {
  it("plans by default, from a typed date", () => {
    const c = setup();
    typeDate("2026-10-03");
    expect(c.planSelected).toHaveBeenCalledWith("2026-10-03");
    expect(c.scheduleSelected).not.toHaveBeenCalled();
  });

  it("sets a DEADLINE in deadline mode", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Deadline" }));
    typeDate("2026-10-03");
    expect(c.scheduleSelected).toHaveBeenCalledWith("2026-10-03");
    expect(c.planSelected).not.toHaveBeenCalled();
  });

  it("snoozes in snooze mode, and offers no Today preset there", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Snooze" }));
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(c.snoozeSelected).toHaveBeenCalledWith("2026-09-27");
  });

  it("clears the plan without touching deadlines", () => {
    const c = setup();
    fireEvent.click(screen.getByRole("button", { name: "Clear the plan" }));
    expect(c.bulkUpdate).toHaveBeenCalledWith({ planned_date: null }, expect.any(Function));
    expect(c.scheduleSelected).not.toHaveBeenCalled();
  });

  it("says so when a phrase is not a date, and writes nothing", () => {
    const c = setup();
    typeDate("whenever I feel like it");
    expect(screen.getByText(/could not read that/i)).toBeInTheDocument();
    expect(c.planSelected).not.toHaveBeenCalled();
  });
});
