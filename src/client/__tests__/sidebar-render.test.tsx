// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { DndContext } from "@dnd-kit/core";
import { Sidebar } from "../components/Sidebar";
import { ToastProvider } from "../lib/toast";

// The sidebar's sections became a keyed, reorderable record rather than a fixed
// run of JSX. That is a large structural edit to the one component every page
// renders, so this is the smoke test: it mounts, it shows its sections, and the
// manage-mode controls exist.

vi.mock("../lib/api", async () => {
  const empty = async () => [];
  return {
    api: {
      listAreas: empty,
      listProjects: empty,
      listLabels: async () => [
        { id: "1", name: "learning", color: null, open_count: 51 },
        { id: "2", name: "reading", color: null, open_count: 26 },
        { id: "3", name: "dead", color: null, open_count: 0 },
      ],
      listFilters: empty,
      listTemplates: empty,
      view: empty,
      getPrefs: async () => ({ hiddenViews: [], viewOrder: [], viewDefaults: {} }),
      savePrefs: async () => ({}),
      me: async () => null,
    },
  };
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <DndContext>
            <Sidebar />
          </DndContext>
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("renders without throwing, with its sections", async () => {
    mount();
    expect(await screen.findByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Areas")).toBeInTheDocument();
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  it("still links the core views", async () => {
    mount();
    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Backlog")).toBeInTheDocument();
    expect(screen.getByText("Whenever")).toBeInTheDocument();
  });

  it("offers section AND view move controls once editing", async () => {
    mount();
    fireEvent.click(await screen.findByText("edit"));
    // A whole section moves...
    expect(screen.getByLabelText("Move the Tasks section down")).toBeInTheDocument();
    expect(screen.getByLabelText("Move the Areas section up")).toBeInTheDocument();
    // ...and a single view moves within its section.
    expect(screen.getByLabelText("Move Today down")).toBeInTheDocument();
    // ...and hiding still works.
    expect(screen.getByLabelText("Hide Today")).toBeInTheDocument();
  });

  it("hides the move controls when not editing", async () => {
    mount();
    await screen.findByText("Tasks");
    expect(screen.queryByLabelText("Move the Tasks section down")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Move Today down")).not.toBeInTheDocument();
  });

  it("shows the busy labels and parks the rest behind a count", async () => {
    mount();
    expect(await screen.findByText("@learning")).toBeInTheDocument();
    expect(screen.getByText("@reading")).toBeInTheDocument();
    // A label with no open task is not offered until "more" is pressed: there
    // is nothing behind it to go and look at.
    expect(screen.queryByText("@dead")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("+1 more"));
    expect(screen.getByText("@dead")).toBeInTheDocument();
  });
});
