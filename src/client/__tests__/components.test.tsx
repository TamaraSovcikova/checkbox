// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
import type { ReactNode } from "react";
import { TaskRow } from "../components/TaskRow";
import { TopBar } from "../components/TopBar";
import { ToastProvider } from "../lib/toast";
import type { Task } from "../../shared/types";

function providers(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DndContext>{ui}</DndContext>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const sample: Task = {
  id: "t1",
  area_id: null,
  project_id: null,
  title: "Buy milk",
  notes: null,
  priority: 2,
  due_date: "2026-07-05",
  due_time: null,
  time_estimate_min: null,
  scheduled_start: null,
  scheduled_end: null,
  board_column: null,
  section_id: null,
  parent_task_id: null,
  recurring_rule_id: null,
  recurrence: null,
  recurrence_mode: "fixed",
  position: 0,
  status: "todo",
  completed_at: null,
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
  labels: [],
  subtasks: [],
};

describe("TaskRow", () => {
  it("renders the title, priority and due date without throwing", () => {
    providers(<TaskRow task={sample} onOpen={() => {}} />);
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("2026-07-05")).toBeInTheDocument();
    // priority renders as the completion-circle border color, not text
  });
});

describe("TopBar", () => {
  it("renders the title and fires onTab when a tab is clicked", () => {
    const onTab = vi.fn();
    render(
      <TopBar
        title="Today"
        tabs={[
          { id: "grid", label: "Grid", icon: null },
          { id: "list", label: "List", icon: null },
        ]}
        activeTab="list"
        onTab={onTab}
      />
    );
    expect(screen.getByText("Today")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Grid"));
    expect(onTab).toHaveBeenCalledWith("grid");
  });
});
