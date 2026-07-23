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
import { todayStr } from "../lib/utils";
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
  time_spent_min: 0,
  timer_started_at: null,
  snoozed_until: null,
  blocked_until: null,
  waiting_on: null,
  waiting_expected: null,
  recurrence_until: null,
  recurrence_count: null,
    gcal_hidden: 0,
  optional: false,
  planned_date: null,
  scheduled_start: null,
  scheduled_end: null,
  board_column: null,
  section_id: null,
  parent_task_id: null,
  recurring_rule_id: null,
  recurrence: null,
  recurrence_mode: "fixed",
  checkpoint_days: null,
  checkpoint_next: null,
  position: 0,
  status: "todo",
  completed_at: null,
  gmail_thread_id: null,
  gmail_message_id: null,
  gmail_permalink: null,
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
  labels: [],
  subtasks: [],
};

describe("TaskRow", () => {
  it("renders the title, priority and due date without throwing", () => {
    // Dated relative to the real today on purpose. The row now humanises the due
    // date, so a hard-coded "2026-07-05" would render differently depending on
    // when the suite runs. Anchoring to today keeps the assertion stable AND
    // pins the case that matters most: the commonest due date reads "Today".
    providers(<TaskRow task={{ ...sample, due_date: todayStr() }} onOpen={() => {}} />);
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    // priority renders as the completion-circle border color, not text
  });

  it("keeps the exact date reachable on hover, not just the humanised label", () => {
    providers(<TaskRow task={{ ...sample, due_date: todayStr() }} onOpen={() => {}} />);
    expect(screen.getByText("Today")).toHaveAttribute("title", todayStr());
  });

  it("marks an optional task without hiding it", () => {
    providers(
      <TaskRow task={{ ...sample, optional: true }} onOpen={() => {}} />
    );
    // The chip says so in words, and the title sits a shade softer.
    expect(screen.getByText("optional")).toBeInTheDocument();
    expect(screen.getByText("Buy milk").className).toContain("text-foreground/70");
  });

  it("leaves a committed task's title at full strength", () => {
    providers(<TaskRow task={sample} onOpen={() => {}} />);
    expect(screen.getByText("Buy milk").className).not.toContain("text-foreground/70");
    expect(screen.queryByText("optional")).not.toBeInTheDocument();
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
