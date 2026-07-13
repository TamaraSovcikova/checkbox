// Quick-capture parsing. The point of these tests is the boundary between
// "this is a real date the user meant" and "this is a prose word chrono got
// too eager about". Real phrases must still parse; weak words must not.

import { describe, it, expect } from "vitest";
import { parseCapture, parseDatePhrase } from "../src/client/lib/nlp";

describe("parseCapture — real dates still parse", () => {
  it("keeps explicit relative dates and times", () => {
    expect(parseCapture("Call landlord tomorrow 3pm").due_date).not.toBeNull();
    expect(parseCapture("Call landlord tomorrow 3pm").due_time).toBe("15:00");
    expect(parseCapture("Submit report next tue").due_date).not.toBeNull();
    expect(parseCapture("Renew in 2 weeks").due_date).not.toBeNull();
    expect(parseCapture("Pay rent on friday").due_date).not.toBeNull();
  });

  it("still strips the date out of the title", () => {
    const p = parseCapture("Call landlord tomorrow 3pm");
    expect(p.title.toLowerCase()).toBe("call landlord");
  });

  it("parses the other tokens independently of the date", () => {
    const p = parseCapture("Draft deck p1 @work #Launch");
    expect(p.priority).toBe(1);
    expect(p.labelNames).toEqual(["work"]);
    expect(p.projectName).toBe("Launch");
    expect(p.due_date).toBeNull();
  });
});

describe("parseCapture — weak prose words do NOT invent a date", () => {
  const weak = [
    "review the morning notes",
    "tidy up in the evening",
    "ask about flexibility e.g. coming in early",
    "circle back later",
    "sometime plan the offsite",
  ];
  for (const s of weak) {
    it(`"${s}" gets no due date and keeps its title intact`, () => {
      const p = parseCapture(s);
      expect(p.due_date).toBeNull();
      expect(p.title).toBe(s);
    });
  }
});

describe("parseDatePhrase — inline sheet editor", () => {
  it("parses a real phrase", () => {
    expect(parseDatePhrase("next monday").due_date).not.toBeNull();
  });
  it("rejects a bare weak word", () => {
    expect(parseDatePhrase("morning")).toEqual({ due_date: null, due_time: null });
  });
});
