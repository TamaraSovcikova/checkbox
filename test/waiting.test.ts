// The waiting-on chip: quiet "waiting" while the expected date holds, warning
// "chase" once it passes, nothing for done tasks or empty text.

import { describe, it, expect } from "vitest";
import { waitingChip } from "../src/client/lib/blocked";

const t = (over: Partial<Parameters<typeof waitingChip>[0]> = {}) => ({
  status: "todo",
  waiting_on: "Revolut card arrives",
  waiting_expected: null as string | null,
  ...over,
});

describe("waitingChip", () => {
  const today = "2026-07-23";

  it("waiting while no expected date is set", () => {
    expect(waitingChip(t(), today)).toEqual({
      kind: "waiting",
      label: "waiting: Revolut card arrives",
    });
  });

  it("waiting while the expected date is today or later", () => {
    expect(waitingChip(t({ waiting_expected: "2026-07-23" }), today)?.kind).toBe("waiting");
    expect(waitingChip(t({ waiting_expected: "2026-07-30" }), today)?.kind).toBe("waiting");
  });

  it("flips to chase once the expected date has passed", () => {
    expect(waitingChip(t({ waiting_expected: "2026-07-22" }), today)).toEqual({
      kind: "chase",
      label: "chase: Revolut card arrives",
    });
  });

  it("nothing for done tasks, empty or whitespace text", () => {
    expect(waitingChip(t({ status: "done" }), today)).toBeNull();
    expect(waitingChip(t({ waiting_on: null }), today)).toBeNull();
    expect(waitingChip(t({ waiting_on: "   " }), today)).toBeNull();
  });
});
