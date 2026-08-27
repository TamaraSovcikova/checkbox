// What the toast says. The second half matters most: completing a blocker now
// writes a planned date onto other tasks, and an automatic write you cannot see
// is how a tool stops being predictable.

import { describe, it, expect } from "vitest";
import { completedMessage } from "../lib/completion";

describe("completedMessage", () => {
  it("is plain when nothing was unblocked", () => {
    expect(completedMessage({ recurrence: null })).toBe("Completed");
  });

  it("explains a recurring task's calm rather than looking broken", () => {
    expect(completedMessage({ recurrence: "daily" })).toBe(
      "Done for today · repeats tomorrow morning"
    );
  });

  it("NAMES the single task it just planned", () => {
    expect(
      completedMessage(
        { recurrence: null },
        { unblocked: [{ id: "a", title: "Send the invoice" }] }
      )
    ).toBe('Completed · unblocked "Send the invoice", planned for today');
  });

  it("counts rather than listing, past one: a toast is not a list", () => {
    expect(
      completedMessage(
        { recurrence: null },
        {
          unblocked: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
            { id: "c", title: "C" },
          ],
        }
      )
    ).toBe("Completed · unblocked 3 tasks, planned for today");
  });

  it("stacks with the recurring wording rather than replacing it", () => {
    expect(
      completedMessage(
        { recurrence: "weekly" },
        { unblocked: [{ id: "a", title: "A" }] }
      )
    ).toBe(
      'Done for today · repeats tomorrow morning · unblocked "A", planned for today'
    );
  });

  it("treats an empty list as nothing happened", () => {
    expect(completedMessage({ recurrence: null }, { unblocked: [] })).toBe(
      "Completed"
    );
  });
});
