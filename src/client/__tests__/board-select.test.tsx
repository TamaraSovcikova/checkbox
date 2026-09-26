// @vitest-environment happy-dom
// Issue #2: board cards take part in multi-select. A plain click opens, a
// modified click goes to the selection, and the select box toggles without
// opening or starting a drag.
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardCard } from "../components/ProjectBoard";
import type { Task } from "../../shared/types";

vi.mock("../components/TaskHoverCard", () => ({
  useTaskHover: () => ({ hoverProps: {}, card: null }),
}));
vi.mock("../components/TaskMeta", () => ({
  TaskMeta: () => null,
  TodayToggle: () => null,
  optionalCardBorder: () => "",
  optionalTitleTone: () => "",
  useTaskArea: () => ({ area: null }),
  useDistantTone: () => "",
  dormantTone: () => "",
}));

const task = {
  id: "t1",
  title: "Write the docs",
  status: "todo",
  subtasks: [],
} as unknown as Task;

function setup(selection?: Partial<Parameters<typeof BoardCard>[0]["selection"]>) {
  const onOpen = vi.fn();
  const sel = selection
    ? {
        selected: false,
        cursor: false,
        active: false,
        onToggle: vi.fn(),
        onRowClick: vi.fn(),
        ...selection,
      }
    : undefined;
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <DndContext>
          <BoardCard task={task} onOpen={onOpen} selection={sel as any} />
        </DndContext>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { onOpen, sel };
}

describe("BoardCard selection", () => {
  it("routes clicks through the selection when there is one", () => {
    const { onOpen, sel } = setup({});
    fireEvent.click(screen.getByText("Write the docs"), { ctrlKey: true });
    expect(sel!.onRowClick).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("the select box toggles without opening the task", () => {
    const { onOpen, sel } = setup({});
    fireEvent.click(screen.getByRole("checkbox", { name: /select write the docs/i }));
    expect(sel!.onToggle).toHaveBeenCalledTimes(1);
    expect(sel!.onRowClick).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("marks a selected card", () => {
    setup({ selected: true, active: true });
    expect(screen.getByRole("checkbox", { name: /select/i })).toHaveAttribute("aria-checked", "true");
  });

  it("without a selection a click still just opens", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByText("Write the docs"));
    expect(onOpen).toHaveBeenCalledWith(task);
    expect(screen.queryByRole("checkbox", { name: /select/i })).toBeNull();
  });
});
