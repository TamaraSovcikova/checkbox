import { useMemo } from "react";
import type { MailCandidateRow } from "../../shared/types";
import {
  useMailCandidates,
  useMailAccept,
  useMailDismiss,
  useGmailStatus,
  useGmailRefresh,
} from "../lib/queries";
import { useToast } from "../lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  MailIcon,
  CheckIcon,
  CloseIcon,
  ExternalLinkIcon,
  AttentionIcon,
  RefreshIcon,
} from "../lib/icons";

type Coverage = MailCandidateRow["coverage"];

const BADGE: Record<Coverage, { label: string; cls: string }> = {
  filed: { label: "Filed", cls: "bg-success/15 text-success" },
  skipped: { label: "Skipped", cls: "bg-surface-2 text-subtle" },
  pending: { label: "Pending", cls: "bg-primary/15 text-primary" },
  needs_attention: {
    label: "Needs attention",
    cls: "bg-[color:var(--area-orange)]/15 text-[color:var(--area-orange)]",
  },
};

// A thread reduced to its latest message plus how many messages it has.
type Thread = { head: MailCandidateRow; count: number };

function CoverageBadge({ coverage }: { coverage: Coverage }) {
  const b = BADGE[coverage];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        b.cls
      )}
    >
      {coverage === "needs_attention" && <AttentionIcon className="h-3 w-3" />}
      {b.label}
    </span>
  );
}

function ThreadRow({ head, count }: Thread) {
  const accept = useMailAccept();
  const dismiss = useMailDismiss();
  const { toast } = useToast();
  const needsReview = head.coverage === "pending" || head.coverage === "needs_attention";
  const when = head.received_at ? head.received_at.slice(0, 10) : "";

  return (
    <div className="group flex items-start gap-3 rounded-md bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <CoverageBadge coverage={head.coverage} />
          <span className="truncate text-sm text-foreground">
            {head.subject || "(no subject)"}
          </span>
          {count > 1 && (
            <span className="shrink-0 text-[11px] text-subtle">+{count - 1} earlier</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-subtle">
          {head.from_addr && <span className="truncate">{head.from_addr}</span>}
          {when && <span>{when}</span>}
          {head.reason && <span className="italic">“{head.reason}”</span>}
        </div>
        {head.snippet && (
          <div className="mt-0.5 truncate text-[12px] text-muted">{head.snippet}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {head.permalink && (
          <a
            href={head.permalink}
            target="_blank"
            rel="noreferrer"
            title="Open the thread in Gmail"
            className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
          >
            <ExternalLinkIcon className="h-4 w-4" />
          </a>
        )}
        {needsReview && (
          <>
            <button
              onClick={() =>
                accept.mutate(head.id, {
                  onSuccess: () => toast("Task created from email"),
                })
              }
              aria-label="Create task"
              title="Create a task from this email"
              className="grid h-7 w-7 place-items-center rounded-md text-success hover:bg-success/10"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
            <button
              onClick={() =>
                dismiss.mutate(head.id, { onSuccess: () => toast("Dismissed") })
              }
              aria-label="Dismiss"
              title="Not task-worthy - dismiss (stays dismissed)"
              className="grid h-7 w-7 place-items-center rounded-md text-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function MailInboxPage() {
  const { data: candidates = [], isLoading } = useMailCandidates(7);
  const { data: gmail } = useGmailStatus();
  const refresh = useGmailRefresh();
  const { toast } = useToast();

  // Reduce messages to threads (latest message is the headline). New messages in
  // an already-handled thread arrive as their own pending rows, so the latest is
  // exactly what needs attention.
  const threads = useMemo<Thread[]>(() => {
    const byThread = new Map<string, MailCandidateRow[]>();
    for (const r of candidates) {
      const arr = byThread.get(r.thread_id) ?? [];
      arr.push(r);
      byThread.set(r.thread_id, arr);
    }
    return [...byThread.values()]
      .map((msgs) => {
        msgs.sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
        return { head: msgs[0], count: msgs.length };
      })
      .sort((a, b) =>
        (b.head.received_at ?? "").localeCompare(a.head.received_at ?? "")
      );
  }, [candidates]);

  const needsReview = threads.filter(
    (t) => t.head.coverage === "pending" || t.head.coverage === "needs_attention"
  );
  const covered = threads.filter(
    (t) => t.head.coverage === "filed" || t.head.coverage === "skipped"
  );
  const counts = {
    filed: threads.filter((t) => t.head.coverage === "filed").length,
    skipped: threads.filter((t) => t.head.coverage === "skipped").length,
    pending: threads.filter((t) => t.head.coverage === "pending").length,
    attention: threads.filter((t) => t.head.coverage === "needs_attention").length,
  };

  return (
    <div className="max-w-2xl pt-4 md:pt-6">
      <div className="mb-1 flex items-center gap-2">
        <MailIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Mail coverage
        </h1>
        {gmail?.connected && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 gap-1.5 text-xs"
            disabled={refresh.isPending}
            onClick={() =>
              refresh.mutate(undefined, {
                onSuccess: (r) =>
                  toast(`Refreshed - ${r.upserted} thread${r.upserted === 1 ? "" : "s"} checked`),
                onError: () => toast("Gmail refresh failed - check Settings"),
              })
            }
          >
            <RefreshIcon className={cn("h-4 w-4", refresh.isPending && "animate-spin")} />
            {refresh.isPending ? "Refreshing…" : "Refresh from Gmail"}
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-subtle">
        Every email thread the planner reviewed in the last 7 days, with what it
        did. Confirm nothing slipped, or file the ones it missed - without opening
        Gmail. Populated by the planner via the <code className="rounded bg-surface-2 px-1 text-[11px]">add_mail_candidates</code> tool.
      </p>

      {/* Coverage summary */}
      <div className="mb-5 flex flex-wrap gap-2 text-xs">
        <span className="rounded-md bg-success/15 px-2 py-1 text-success">
          {counts.filed} filed
        </span>
        <span className="rounded-md bg-surface-2 px-2 py-1 text-subtle">
          {counts.skipped} skipped
        </span>
        <span className="rounded-md bg-primary/15 px-2 py-1 text-primary">
          {counts.pending} pending
        </span>
        {counts.attention > 0 && (
          <span className="rounded-md bg-[color:var(--area-orange)]/15 px-2 py-1 text-[color:var(--area-orange)]">
            {counts.attention} needs attention
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : threads.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface/40 p-6 text-center">
          <MailIcon className="mx-auto mb-2 h-6 w-6 text-subtle" />
          <p className="text-sm text-subtle">
            No coverage recorded yet. It fills in when the planner next runs and
            records a verdict for each thread it reviews.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-foreground/80">
              Needs review{" "}
              <span className="text-subtle">
                {needsReview.length > 0 ? needsReview.length : ""}
              </span>
            </h2>
            {needsReview.length === 0 ? (
              <p className="text-xs text-subtle">
                All caught up - nothing waiting on you.
              </p>
            ) : (
              <div className="space-y-1.5">
                {needsReview.map((t) => (
                  <ThreadRow key={t.head.id} {...t} />
                ))}
              </div>
            )}
          </section>

          {covered.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                Covered {covered.length}
              </h2>
              <div className="space-y-1.5 opacity-80">
                {covered.map((t) => (
                  <ThreadRow key={t.head.id} {...t} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
