// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DndContext } from "@dnd-kit/core";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { TaskRow } from "../components/TaskRow";
import { TopBar } from "../components/TopBar";
import { ToastProvider } from "../lib/toast";
import { todayStr } from "../lib/utils";
import type { Task } from "../../shared/types";

function providers(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A router, because a row reads ?focus= to know whether it is the task the
  // sheet's Navigate button just sent you to. The app always has one; a test
  // without one was only ever testing a shape the app never renders.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <DndContext>{ui}</DndContext>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
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
  source_path: null,
  source_line: null,
  source_text: null,
  vault_dirty: 0,
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

  // Due and planned are two dates now. A plan for a day other than today has to
  // be readable from the list, or setting it would have made the task LESS
  // visible than leaving it alone.
  it("says which day a task is planned for, when that is not today", () => {
    const [y, m, d] = todayStr().split("-").map(Number);
    const inThree = new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
    providers(<TaskRow task={{ ...sample, planned_date: inThree }} onOpen={() => {}} />);
    expect(screen.getByText(/^plan /)).toHaveAttribute(
      "title",
      `Planned for ${inThree}`
    );
  });

  it("leaves today's plan to the Today marker rather than printing a chip", () => {
    providers(
      <TaskRow task={{ ...sample, planned_date: todayStr() }} onOpen={() => {}} />
    );
    expect(screen.queryByText(/^plan /)).not.toBeInTheDocument();
  });

  it("names a carried-forward plan as carried, not as overdue", () => {
    const [y, m, d] = todayStr().split("-").map(Number);
    const threeAgo = new Date(Date.UTC(y, m - 1, d - 3)).toISOString().slice(0, 10);
    providers(<TaskRow task={{ ...sample, planned_date: threeAgo }} onOpen={() => {}} />);
    const chip = screen.getByText(/^plan /);
    expect(chip).toHaveAttribute("title", `Planned for ${threeAgo} (carried forward)`);
    // A missed plan is a plan to move, not a broken promise: never danger-toned.
    expect(chip.className).toContain("text-muted");
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

  // A task whose only claim on today is a step renders as that step. Her ask:
  // "when a subtask is due I don't want the main task card to show up on my
  // today board but the subtask itself... it has to be clear that it's part of
  // the main task, but primarily you should see the subtask".
  describe("step-led", () => {
    const step = {
      id: "s1",
      task_id: "t1",
      title: "post the form",
      done: false,
      position: 0,
      due_date: todayStr(),
      priority: null,
    };
    // The task itself is due far out, so the step is the ONLY reason it is here.
    const stepLed: Task = { ...sample, due_date: "2030-01-01", subtasks: [step] };

    it("shows the step as the work and the task as its context", () => {
      providers(<TaskRow task={stepLed} onOpen={() => {}} />);
      expect(screen.getByText("post the form")).toBeInTheDocument();
      // The parent is still named (it has to read as part of that task), quietly.
      expect(screen.getByTitle("Part of: Buy milk")).toBeInTheDocument();
    });

    it("the tick completes the STEP, not the whole task", () => {
      providers(<TaskRow task={stepLed} onOpen={() => {}} />);
      expect(screen.getByLabelText("Complete post the form")).toBeInTheDocument();
      // No circle that would complete the parent: on this row that is a trap.
      expect(screen.queryByLabelText("Complete")).not.toBeInTheDocument();
    });

    it("does not print the leading step twice", () => {
      providers(
        <TaskRow
          task={{
            ...stepLed,
            subtasks: [step, { ...step, id: "s2", title: "other", due_date: null }],
          }}
          onOpen={() => {}}
        />
      );
      expect(screen.getAllByText("post the form")).toHaveLength(1);
      // The rest of the checklist is still reachable, and the counter still
      // reports the whole task's progress.
      expect(screen.getByLabelText("Show subtasks")).toBeInTheDocument();
      expect(screen.getByTitle("0 of 2 subtasks done")).toBeInTheDocument();
    });

    it("asks before finishing a task whose steps are still open", () => {
      providers(
        <TaskRow
          task={{ ...sample, subtasks: [{ ...step, due_date: null }] }}
          onOpen={() => {}}
        />
      );
      fireEvent.click(screen.getByLabelText("Complete"));
      // The guard, not the completion: it names the count and offers both
      // honest answers plus the bail-out.
      expect(screen.getByText("1 unfinished subtask")).toBeInTheDocument();
      expect(screen.getByText("Complete all 1 and finish")).toBeInTheDocument();
      expect(
        screen.getByText("Finish anyway, leave subtasks open")
      ).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    // These two DO go through to the completion call. Stub fetch so the test
    // asserts on the absence of the dialog rather than on a network error.
    it("does not ask when every step is ticked", () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      providers(
        <TaskRow
          task={{ ...sample, subtasks: [{ ...step, due_date: null, done: true }] }}
          onOpen={() => {}}
        />
      );
      fireEvent.click(screen.getByLabelText("Complete"));
      expect(screen.queryByText(/unfinished subtask/)).not.toBeInTheDocument();
    });

    it("does not ask when UN-completing: putting a task back claims nothing", () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      providers(
        <TaskRow
          task={{ ...sample, status: "done", subtasks: [{ ...step, due_date: null }] }}
          onOpen={() => {}}
        />
      );
      fireEvent.click(screen.getByLabelText("Complete"));
      expect(screen.queryByText(/unfinished subtask/)).not.toBeInTheDocument();
    });

    it("a task in Today on its own account keeps its own title and circle", () => {
      providers(
        <TaskRow task={{ ...sample, due_date: todayStr(), subtasks: [step] }} onOpen={() => {}} />
      );
      expect(screen.getByText("Buy milk")).toBeInTheDocument();
      expect(screen.getByLabelText("Complete")).toBeInTheDocument();
      expect(screen.queryByTitle("Part of: Buy milk")).not.toBeInTheDocument();
    });
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
