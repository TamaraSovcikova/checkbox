// @vitest-environment happy-dom
// #10: a share link no longer creates a task on page load. It shows what it
// would add and waits for one tap.
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mutate = vi.fn();
vi.mock("../lib/queries", () => ({ useCreateTask: () => ({ mutate, isPending: false }) }));
vi.mock("../lib/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { SharePage, shareDraft } from "../SharePage";

function open(q: string) {
  render(
    <MemoryRouter initialEntries={[`/share?${q}`]}>
      <SharePage />
    </MemoryRouter>
  );
}

describe("share target", () => {
  it("does not create anything until the tap", () => {
    mutate.mockClear();
    open("title=Read%20this%20article&url=https%3A%2F%2Fexample.com%2Fa");
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Read this article")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Backlog" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      title: "Read this article",
      notes: "https://example.com/a",
    });
  });

  it("puts a bare shared link in notes, not the title", () => {
    const d = shareDraft(new URLSearchParams({ text: "https://example.com/x" }));
    expect(d).toMatchObject({ title: "Look at this link", notes: "https://example.com/x" });
  });

  it("has nothing to offer for an empty share", () => {
    expect(shareDraft(new URLSearchParams())).toBeNull();
  });
});
