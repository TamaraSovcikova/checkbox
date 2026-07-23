// The Gmail coverage upsert precedence. These tests ARE the spec for the single
// most bug-prone piece of Phase A: the verdict lattice, the user lock, and the
// task_id COALESCE. See design findings A1 (lock) and A4 (COALESCE).

import { describe, it, expect } from "vitest";
import {
  resolveMailUpsert,
  coverageState,
  isBulkMail,
  type MailCandidate,
  type Verdict,
} from "../src/shared/mail";

const cand = (over: Partial<MailCandidate> = {}): MailCandidate => ({
  source: "planner",
  thread_id: "th1",
  message_id: "m1",
  from_addr: "a@example.com",
  subject: "Subject",
  permalink: "https://mail.google.com/x",
  snippet: "snippet",
  received_at: "2026-07-13T09:00:00Z",
  verdict: "pending",
  reason: null,
  task_id: null,
  user_locked: 0,
  ...over,
});

const VERDICTS: Verdict[] = ["pending", "skipped", "filed"];

describe("resolveMailUpsert — fresh insert", () => {
  it("takes the incoming row and is never born locked", () => {
    const r = resolveMailUpsert(null, cand({ verdict: "filed", user_locked: 1 }));
    expect(r.verdict).toBe("filed");
    expect(r.user_locked).toBe(0);
  });
});

describe("resolveMailUpsert — verdict lattice (unlocked)", () => {
  // The full 3x3: rows = stored verdict, cols = incoming verdict.
  for (const stored of VERDICTS) {
    for (const incoming of VERDICTS) {
      const rank = { pending: 0, skipped: 1, filed: 2 };
      const isUpgrade = rank[incoming] > rank[stored];
      it(`stored=${stored} incoming=${incoming} → ${isUpgrade ? "upgrade" : "keep"}`, () => {
        const r = resolveMailUpsert(
          cand({ verdict: stored, reason: "stored-reason", source: "planner" }),
          cand({ verdict: incoming, reason: "incoming-reason", source: "gmail_sync" })
        );
        if (isUpgrade) {
          expect(r.verdict).toBe(incoming);
          expect(r.reason).toBe("incoming-reason");
          expect(r.source).toBe("gmail_sync");
        } else {
          expect(r.verdict).toBe(stored); // downgrade or tie: stored wins
          expect(r.reason).toBe("stored-reason");
          expect(r.source).toBe("planner");
        }
      });
    }
  }

  it("tie on filed: first filer keeps its task_id (does not adopt the incoming one)", () => {
    const r = resolveMailUpsert(
      cand({ verdict: "filed", task_id: "task-A" }),
      cand({ verdict: "filed", task_id: "task-B" })
    );
    expect(r.task_id).toBe("task-A");
  });

  it("upgrade to filed adopts the incoming task_id", () => {
    const r = resolveMailUpsert(
      cand({ verdict: "pending", task_id: null }),
      cand({ verdict: "filed", task_id: "task-B" })
    );
    expect(r.task_id).toBe("task-B");
  });

  it("upgrade with no incoming task_id COALESCEs to the stored one (never NULLs)", () => {
    const r = resolveMailUpsert(
      cand({ verdict: "skipped", task_id: "task-A" }),
      cand({ verdict: "filed", task_id: null })
    );
    expect(r.task_id).toBe("task-A");
  });

  it("always refreshes the freshness fields, even on a downgrade", () => {
    const r = resolveMailUpsert(
      cand({ verdict: "filed", snippet: "old", received_at: "old", permalink: "old" }),
      cand({ verdict: "pending", snippet: "new", received_at: "new", permalink: "new" })
    );
    expect(r.verdict).toBe("filed");
    expect(r.snippet).toBe("new");
    expect(r.received_at).toBe("new");
    expect(r.permalink).toBe("new");
  });
});

describe("resolveMailUpsert — the user lock wins over any writer", () => {
  it("a locked row cannot be re-filed by a writer (Dismiss sticks — A1)", () => {
    // Human dismissed → skipped + locked. The next planner run computes filed.
    const r = resolveMailUpsert(
      cand({ verdict: "skipped", reason: "dismissed by user", user_locked: 1, task_id: null }),
      cand({ verdict: "filed", reason: "looks task-worthy", task_id: "task-X", source: "planner" })
    );
    expect(r.verdict).toBe("skipped");
    expect(r.reason).toBe("dismissed by user");
    expect(r.task_id).toBeNull();
    expect(r.user_locked).toBe(1);
  });

  it("a locked row still accepts freshness updates", () => {
    const r = resolveMailUpsert(
      cand({ verdict: "filed", user_locked: 1, snippet: "old" }),
      cand({ verdict: "filed", snippet: "new" })
    );
    expect(r.snippet).toBe("new");
    expect(r.user_locked).toBe(1);
  });
});

describe("coverageState", () => {
  it("filed with a task is covered; filed without a task needs attention", () => {
    expect(coverageState({ verdict: "filed", task_id: "t" })).toBe("filed");
    expect(coverageState({ verdict: "filed", task_id: null })).toBe("needs_attention");
  });
  it("passes pending and skipped through", () => {
    expect(coverageState({ verdict: "pending", task_id: null })).toBe("pending");
    expect(coverageState({ verdict: "skipped", task_id: null })).toBe("skipped");
  });
});

describe("isBulkMail — ingest classification", () => {
  it("List-Unsubscribe is the canonical bulk marker", () => {
    expect(isBulkMail("Semafor <flagship@semafor.com>", "<mailto:unsub@semafor.com>", null)).toBe(true);
  });

  it("Precedence bulk/list/junk marks bulk", () => {
    expect(isBulkMail("someone@example.com", null, "bulk")).toBe(true);
    expect(isBulkMail("someone@example.com", null, "list")).toBe(true);
    expect(isBulkMail("someone@example.com", null, "junk")).toBe(true);
  });

  it("do-not-reply style senders mark bulk", () => {
    expect(isBulkMail("Eventbrite <noreply@event.eventbrite.com>", null, null)).toBe(true);
    expect(isBulkMail("GitHub <notifications@github.com>", null, null)).toBe(true);
    expect(isBulkMail("Acme <do-not-reply@acme.com>", null, null)).toBe(true);
    expect(isBulkMail("SME <newsletter@mg.sme.sk>", null, null)).toBe(true);
  });

  it("a human sender with no bulk signals is NOT bulk", () => {
    expect(isBulkMail("Anouar <anouar@vikingqa.io>", null, null)).toBe(false);
    expect(isBulkMail(null, null, null)).toBe(false);
    expect(isBulkMail("Franz <franz@gmail.com>", "", null)).toBe(false);
  });

  it("Precedence 'first-class' or unrelated values are not bulk", () => {
    expect(isBulkMail("a@b.com", null, "first-class")).toBe(false);
  });
});
