// @vitest-environment happy-dom
//
// Regression: the timeline's scroll-to-now effect was written BELOW the
// "calendar not connected" early return. `status` is undefined while the query
// loads and connected on the next render, so the component ran a different
// NUMBER of hooks between those two renders and React threw #310, blanking the
// whole app. It only reproduced on an account with Google Calendar actually
// connected, which is why local testing (never connected, early return always
// taken) missed it entirely.
//
// So: render across exactly that transition, with the calendar connected.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TodayTimeline } from "../components/TodayTimeline";
import { TaskUIContext } from "../lib/ui-context";
import { api } from "../lib/api";

function providers(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaskUIContext.Provider value={{ open: () => {} }}>{ui}</TaskUIContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // Not connected until resolved, then connected: the exact two-render sequence
  // that changed the hook count.
  vi.spyOn(api, "calendarStatus").mockResolvedValue({
    connected: true,
    google_email: "a@example.com",
  } as never);
  vi.spyOn(api, "calendarEvents").mockResolvedValue([] as never);
});

afterEach(() => vi.restoreAllMocks());

describe("TodayTimeline", () => {
  it("survives the not-connected to connected transition", async () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((e) => errors.push(e));

    providers(<TodayTimeline tasks={[]} />);

    // First paint: still loading, so it shows the connect prompt.
    expect(screen.getByText(/Connect Google Calendar/i)).toBeInTheDocument();

    // Once the status resolves it swaps to the real panel. If the hook order
    // were unstable this render is where React would throw.
    await waitFor(() =>
      expect(screen.queryByText(/Connect Google Calendar/i)).not.toBeInTheDocument()
    );
    expect(screen.getByText(/view only/i)).toBeInTheDocument();

    const hookErrors = errors.filter((e) => /hook|#310|Rendered more/i.test(String(e)));
    expect(hookErrors).toEqual([]);
    spy.mockRestore();
  });

  it("renders the empty-day message without a scroll container", async () => {
    providers(<TodayTimeline tasks={[]} />);
    await waitFor(() =>
      expect(screen.getByText(/Nothing booked today/i)).toBeInTheDocument()
    );
  });

  it("offers the full-day toggle only when given a handler", async () => {
    const { unmount } = providers(<TodayTimeline tasks={[]} />);
    await waitFor(() => expect(screen.getByText(/view only/i)).toBeInTheDocument());
    // No handler passed, and an empty day: no toggle to press.
    expect(screen.queryByText(/Full day/i)).not.toBeInTheDocument();
    unmount();
  });
});
