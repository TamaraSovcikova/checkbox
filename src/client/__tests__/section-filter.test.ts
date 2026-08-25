// The section picker's search.
//
// Pinned because the first cut shipped cmdk's default fuzzy scorer and, on her
// real projects, answering "career" with VikingQA (Neocap SRO), Technical
// Fluency (R-035/036/037) and Intimacy: every letter of "career" appears in each
// of those, in order, which is all a subsequence match asks for. A filter you
// cannot trust is worse than none, because you have to read the whole list
// anyway.

import { describe, it, expect } from "vitest";
import { matches } from "../components/SectionPicker";

const hit = (value: string, search: string) => matches(value, search) === 1;

describe("section picker search", () => {
  it("matches on a substring of the name", () => {
    expect(hit("Founder Path Career proj:p1", "founder")).toBe(true);
    expect(hit("Founder Path Career proj:p1", "path")).toBe(true);
  });

  it("finds a project by the AREA it sits in", () => {
    expect(hit("Founder Path Career proj:p1", "career")).toBe(true);
  });

  it("does NOT match a scattered subsequence", () => {
    expect(hit("Technical Fluency (R-035/036/037) Learning proj:p2", "career")).toBe(false);
    expect(hit("Intimacy Relationships proj:p3", "career")).toBe(false);
    expect(hit("VikingQA (Neocap SRO) Brussels proj:p4", "career")).toBe(false);
  });

  it("requires every term, so two words narrow rather than widen", () => {
    expect(hit("Founder Path Career proj:p1", "career path")).toBe(true);
    expect(hit("Author Path Career proj:p5", "career path")).toBe(true);
    expect(hit("Author Path Career proj:p5", "career founder")).toBe(false);
  });

  it("ignores case and stray spaces", () => {
    expect(hit("LinkedIn Revamp Career proj:p6", "  LINKEDIN   revamp ")).toBe(true);
  });
});
