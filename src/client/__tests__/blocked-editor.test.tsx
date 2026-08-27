// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { BlockedEditor } from "../components/DependencyEditor";
import { ToastProvider } from "../lib/toast";
import type { Task } from "../../shared/types";

// The sheet does not remount when you move between tasks: clicking a linked
// task's chip swaps the `task` prop on the same component tree. So any state
// this control keeps about what the user opened belongs to the task it was
// opened on, and has to be dropped when the task changes. It was not, so
// opening "A date" on one task showed an empty date editor on the next one.

const task = (over: Partial<Task>): Task =>
  ({
    id: "t1",
    title: "x",
    status: "todo",
    depends_on: [],
    blocks: [],
    related: [],
    subtasks: [],
    blocked_until: null,
    waiting_on: null,
    waiting_expected: null,
    ...over,
  }) as Task;

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>{ui}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("BlockedEditor", () => {
  it("is one chip on a task that is waiting on nothing", () => {
    wrap(<BlockedEditor task={task({})} />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.queryByText("Blocked until")).not.toBeInTheDocument();
    expect(screen.queryByText("Waiting on")).not.toBeInTheDocument();
  });

  it("asks the one question, in plain words, and opens the kind you pick", () => {
    wrap(<BlockedEditor task={task({})} />);
    fireEvent.click(screen.getByText("Blocked"));
    expect(screen.getByText("What is it waiting on?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("A date"));
    expect(screen.getByText("Blocked until")).toBeInTheDocument();
    // ...and only that one.
    expect(screen.queryByText("Waiting on")).not.toBeInTheDocument();
  });

  it("shows a kind that already holds a value without being asked", () => {
    wrap(<BlockedEditor task={task({ waiting_on: "Revolut card" })} />);
    expect(screen.getByText("Waiting on")).toBeInTheDocument();
    expect(screen.queryByText("Blocked until")).not.toBeInTheDocument();
  });

  it("FORGETS what you opened when the sheet moves to another task", () => {
    const { rerender } = wrap(<BlockedEditor task={task({ id: "t1" })} />);
    fireEvent.click(screen.getByText("Blocked"));
    fireEvent.click(screen.getByText("A date"));
    expect(screen.getByText("Blocked until")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <BlockedEditor task={task({ id: "t2" })} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    expect(screen.queryByText("Blocked until")).not.toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("closes the half-open kind picker when the task changes", () => {
    const { rerender } = wrap(<BlockedEditor task={task({ id: "t1" })} />);
    fireEvent.click(screen.getByText("Blocked"));
    expect(screen.getByText("What is it waiting on?")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider>
            <BlockedEditor task={task({ id: "t2" })} />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );
    expect(screen.queryByText("What is it waiting on?")).not.toBeInTheDocument();
  });
});
