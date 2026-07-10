import { describe, it, expect } from "vitest";
import {
  bestDestination,
  scoreDestinations,
  TRIAGE_THRESHOLD,
  type TriageDest,
} from "../src/shared/triage";

// Two areas whose vocabulary comes from the tasks already filed in them. Note
// that neither name appears in the backlog titles below: that is exactly the
// case the old name-only matcher could never handle.
const health: TriageDest = {
  id: "health",
  kind: "area",
  name: "Health",
  areaId: "health",
  corpus:
    "Health book physio appointment buy vitamins gym session run 5k dentist checkup groceries oat milk",
};
const work: TriageDest = {
  id: "work",
  kind: "area",
  name: "Work",
  areaId: "work",
  corpus:
    "Work draft quarterly report review pull request deploy release invoice client standup",
};
const areas = [health, work];

describe("scoreDestinations", () => {
  it("matches on learned vocabulary, not just the destination name", () => {
    const ranked = scoreDestinations("Buy oat milk", null, areas);
    expect(ranked[0].dest.id).toBe("health");
    expect(ranked[0].score).toBeGreaterThan(TRIAGE_THRESHOLD);
  });

  it("routes work vocabulary to the work area", () => {
    const ranked = scoreDestinations("Draft the quarterly report", null, areas);
    expect(ranked[0].dest.id).toBe("work");
  });

  it("uses notes as extra signal", () => {
    const ranked = scoreDestinations("Follow up", "chase the client invoice", areas);
    expect(ranked[0].dest.id).toBe("work");
  });

  it("stems plurals so report/reports collide", () => {
    const ranked = scoreDestinations("Reports", null, areas);
    expect(ranked[0].dest.id).toBe("work");
  });

  it("returns nothing when there is no shared vocabulary", () => {
    const ranked = scoreDestinations("Xylophone zqrt", null, areas);
    expect(ranked).toHaveLength(0);
  });

  it("handles an empty destination list", () => {
    expect(scoreDestinations("anything", null, [])).toEqual([]);
  });
});

describe("bestDestination", () => {
  it("returns null below the confidence threshold (caller falls back)", () => {
    expect(bestDestination("Xylophone zqrt", null, areas)).toBeNull();
  });

  it("prefers a project over its parent area when both match", () => {
    const project: TriageDest = {
      id: "p1",
      kind: "project",
      name: "Q3 report",
      areaId: "work",
      corpus: "Q3 report draft quarterly report review",
    };
    const best = bestDestination("Draft quarterly report", null, [work, project]);
    expect(best?.dest.kind).toBe("project");
    expect(best?.dest.id).toBe("p1");
  });

  it("reports which task words drove the match", () => {
    const best = bestDestination("Book physio appointment", null, areas);
    expect(best?.dest.id).toBe("health");
    expect(best?.matched).toContain("physio");
  });

  it("an ad-hoc task with no shared words yields no match", () => {
    expect(bestDestination("Ask about flexibility", null, areas)).toBeNull();
  });
});
