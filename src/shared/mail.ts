// Gmail coverage: the multi-writer upsert precedence, kept pure so the whole
// 3x3 verdict matrix (plus the lock and the COALESCE) is unit-testable away from
// the DB. This is the single most bug-prone piece of Phase A (design finding A5).
//
// Two orthogonal axes decide what a WRITER (planner / gmail_sync / forward) may
// change when its incoming row collides with a stored one on message_id:
//
//   Axis 0: the lock (checked first). If the stored row is user_locked, a
//     writer may refresh ONLY the freshness fields (snippet/received_at/
//     permalink). A human has ruled; no writer overturns it. This is what makes
//     Dismiss stick (finding A1).
//
//   Axis 1: the verdict lattice (only when unlocked), pending < skipped < filed:
//     upgrade (Vin > Vcur)  -> take incoming verdict/reason/source, COALESCE task_id
//     downgrade (Vin < Vcur)-> never; refresh freshness only
//     tie (Vin == Vcur)     -> first filer wins; refresh freshness only
//   task_id is never nulled by an upsert (COALESCE).
//
// Human actions (Dismiss / Accept / Create task) do NOT go through here, they
// write directly and set user_locked = 1.

export type Verdict = "pending" | "skipped" | "filed";

const RANK: Record<Verdict, number> = { pending: 0, skipped: 1, filed: 2 };

export type MailCandidate = {
  source: string;
  thread_id: string;
  message_id: string;
  from_addr: string | null;
  subject: string | null;
  permalink: string | null;
  snippet: string | null;
  received_at: string | null;
  verdict: Verdict;
  reason: string | null;
  task_id: string | null;
  user_locked: number; // 0 | 1
};

// The fields a writer is allowed to refresh regardless of verdict/lock.
function freshness(
  incoming: MailCandidate,
  stored: MailCandidate | null
): Pick<MailCandidate, "snippet" | "received_at" | "permalink"> {
  return {
    snippet: incoming.snippet ?? stored?.snippet ?? null,
    received_at: incoming.received_at ?? stored?.received_at ?? null,
    permalink: incoming.permalink ?? stored?.permalink ?? null,
  };
}

// Compute the row to persist for an incoming WRITER candidate, given the stored
// row (or null for a fresh insert). Pure: no IDs, no timestamps, no DB.
export function resolveMailUpsert(
  stored: MailCandidate | null,
  incoming: MailCandidate
): MailCandidate {
  // Fresh insert: take the incoming row as-is, never born locked.
  if (!stored) return { ...incoming, user_locked: 0 };

  const fresh = freshness(incoming, stored);

  // Axis 0: a human-locked row is frozen against writers.
  if (stored.user_locked === 1) return { ...stored, ...fresh };

  // Axis 1: verdict lattice.
  if (RANK[incoming.verdict] > RANK[stored.verdict]) {
    // Upgrade: the incoming writer's verdict wins and it becomes the owner.
    return {
      ...stored,
      ...fresh,
      source: incoming.source,
      verdict: incoming.verdict,
      reason: incoming.reason,
      task_id: incoming.task_id ?? stored.task_id, // never NULL out a real id
      user_locked: 0,
    };
  }

  // Downgrade or tie (first filer wins): keep the stored decision, refresh only.
  return { ...stored, ...fresh };
}

// Coverage classification for one row, matching the UI's badge semantics.
// `filed` with no task_id is the "needs attention" false-positive the whole
// feature exists to prevent (a task was filed then deleted): it counts as
// UNCOVERED, never as covered.
export function coverageState(
  row: Pick<MailCandidate, "verdict"> & { task_id: string | null }
): "filed" | "skipped" | "pending" | "needs_attention" {
  if (row.verdict === "filed") return row.task_id ? "filed" : "needs_attention";
  return row.verdict;
}
