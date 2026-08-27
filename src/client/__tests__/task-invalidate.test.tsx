// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTaskInvalidate } from "../lib/queries";

// Deleting a task from a SAVED FILTER left the row on screen, still clickable,
// still opening a sheet for a task that no longer existed, until a manual
// reload. The filter page reads ["filter-tasks", id]; the invalidator knew only
// ["view"] and ["tasks"]. It was never delete-specific: every mutation was
// silently ignored on that one page.
//
// Pinned as a list rather than as one case, because the bug was an OMISSION and
// the next omission will look exactly the same. A cache that holds task data and
// is not listed here does not refresh.

const KEYS = [
  ["view", "today"],
  ["tasks", { area_id: "a1" }],
  ["filter-tasks", "f1"],
  ["day-plan"],
  ["review"],
  ["stats"],
  ["pins"],
  ["triage"],
];

function run() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Seed each key with data and mark it fresh, so "stale" afterwards can only
  // be the invalidator's doing.
  for (const k of KEYS) qc.setQueryData(k, []);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useTaskInvalidate(), { wrapper });
  result.current();
  return qc;
}

describe("useTaskInvalidate", () => {
  it("refreshes every cache that holds task data", () => {
    const qc = run();
    for (const k of KEYS) {
      const state = qc.getQueryState(k);
      expect(state, `no query for ${JSON.stringify(k)}`).toBeDefined();
      expect(state!.isInvalidated, `${JSON.stringify(k)} was not invalidated`).toBe(
        true
      );
    }
  });

  it("covers a saved filter, which is the one that went stale", () => {
    const qc = run();
    expect(qc.getQueryState(["filter-tasks", "f1"])!.isInvalidated).toBe(true);
  });

  it("leaves caches that hold no task data alone", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["areas"], []);
    qc.setQueryData(["labels"], []);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useTaskInvalidate(), { wrapper });
    result.current();
    expect(qc.getQueryState(["areas"])!.isInvalidated).toBe(false);
    expect(qc.getQueryState(["labels"])!.isInvalidated).toBe(false);
  });
});
