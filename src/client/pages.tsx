import { useState } from "react";
import { useParams } from "react-router-dom";
import type { Task, TriageSuggestion } from "../shared/types";
import {
  useAreas,
  useProjects,
  useTasks,
  useView,
  useTriageSuggestions,
  useTriageGenerate,
  useTriageAccept,
  useTriageReject,
  usePushStatus,
} from "./lib/queries";
import { useTaskUI } from "./lib/ui-context";
import { QuickCapture } from "./components/QuickCapture";
import { ProjectBoard } from "./components/ProjectBoard";
import { TaskRow } from "./components/TaskRow";
import { ViewToolbar, ToolbarButton } from "./components/ViewToolbar";
import { useViewPrefs } from "./lib/queries";
import { Button, cx } from "./components/ui";
import { api } from "./lib/api";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

function Header({
  title,
  sub,
  icon,
  actions,
}: {
  title: string;
  sub?: string;
  icon?: string;
  actions?: ReactNode;
}) {
  return <ViewToolbar title={title} sub={sub} icon={icon} actions={actions} />;
}

function TaskList({ tasks, empty }: { tasks: Task[]; empty: string }) {
  const { open } = useTaskUI();
  if (tasks.length === 0)
    return <p className="px-2 text-sm text-slate-600">{empty}</p>;
  return (
    <div className="max-w-2xl">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onOpen={open} />
      ))}
    </div>
  );
}

const VIEW_META: Record<
  string,
  { title: string; sub: string; empty: string; icon: string }
> = {
  today: { title: "Today", sub: "Due, scheduled, or overdue", empty: "Nothing due today.", icon: "☀" },
  upcoming: { title: "Upcoming", sub: "Coming up", empty: "Nothing upcoming.", icon: "→" },
  overdue: { title: "Overdue", sub: "Past due", empty: "Nothing overdue. Nice.", icon: "⚠" },
  backlog: { title: "Backlog", sub: "Unassigned - triage later", empty: "Backlog is empty.", icon: "📥" },
  logbook: { title: "Logbook", sub: "Completed", empty: "No completed tasks yet.", icon: "✓" },
};

export function ViewPage({ name }: { name: string }) {
  const { data: tasks = [] } = useView(name);
  const meta = VIEW_META[name];
  const { hide } = useViewPrefs();
  return (
    <div>
      <Header
        title={meta.title}
        sub={meta.sub}
        icon={meta.icon}
        actions={
          <ToolbarButton title="Hide this view" onClick={() => hide(`/${name}`)}>
            ⊘
          </ToolbarButton>
        }
      />
      {name !== "logbook" && (
        <div className="mb-4 max-w-2xl">
          <QuickCapture />
        </div>
      )}
      {name === "backlog" ? (
        <BacklogBody tasks={tasks} />
      ) : (
        <TaskList tasks={tasks} empty={meta.empty} />
      )}
    </div>
  );
}

// ── Backlog with triage panel ─────────────────────────────────────────────────

function TriageCard({
  sug,
  onAccept,
  onReject,
}: {
  sug: TriageSuggestion;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const dest = sug.project_name
    ? `${sug.area_name ? sug.area_name + " › " : ""}${sug.project_name}`
    : sug.area_name ?? "Unassigned";

  const confidenceCls =
    sug.confidence >= 0.5
      ? "text-emerald-400"
      : sug.confidence > 0
      ? "text-amber-400"
      : "text-slate-500";

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <p className="mb-1 text-sm font-medium leading-snug">{sug.task_title}</p>
      <p className="mb-2 text-xs text-slate-400">
        → <span className="text-slate-200">{dest}</span>
        <span className={cx("ml-2 text-[11px]", confidenceCls)}>
          {sug.confidence > 0 ? `${Math.round(sug.confidence * 100)}% match` : "no match"}
        </span>
      </p>
      <p className="mb-3 text-[11px] text-slate-500">{sug.reason}</p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          className="h-7 px-3 text-xs"
          onClick={() => onAccept(sug.id)}
          disabled={!sug.area_name && !sug.project_name}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-3 text-xs"
          onClick={() => onReject(sug.id)}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

function BacklogBody({ tasks }: { tasks: Task[] }) {
  const [triageOpen, setTriageOpen] = useState(false);
  const { data: suggestions = [], isLoading: loadingSugs } = useTriageSuggestions();
  const generate = useTriageGenerate();
  const accept = useTriageAccept();
  const reject = useTriageReject();

  const pending = suggestions.filter((s) => s.status === "pending");

  async function handleGenerate() {
    setTriageOpen(true);
    await generate.mutateAsync();
  }

  return (
    <div className="max-w-3xl">
      {/* Triage panel */}
      <div className="mb-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">AI Triage</span>
            <span className="ml-2 text-xs text-slate-500">
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} in backlog
            </span>
          </div>
          <Button
            variant="subtle"
            className="h-7 text-xs"
            onClick={handleGenerate}
            disabled={generate.isPending || tasks.length === 0}
          >
            {generate.isPending ? "Analysing…" : "Suggest placements"}
          </Button>
        </div>

        {triageOpen && (
          <>
            {loadingSugs && !pending.length ? (
              <p className="text-xs text-slate-500">Loading suggestions…</p>
            ) : pending.length === 0 ? (
              <p className="text-xs text-slate-500">
                {tasks.length === 0
                  ? "Backlog is empty."
                  : "No suggestions yet — click «Suggest placements» to analyse."}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {pending.map((s) => (
                  <TriageCard
                    key={s.id}
                    sug={s}
                    onAccept={(id) => accept.mutate(id)}
                    onReject={(id) => reject.mutate(id)}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!triageOpen && tasks.length > 0 && (
          <p className="text-xs text-slate-600">
            Keyword-match suggestions across your areas and projects.
            Claude can do deeper triage via MCP → <code>triage_backlog</code>.
          </p>
        )}
      </div>

      {/* Task list */}
      <TaskList tasks={tasks} empty="Backlog is empty." />
    </div>
  );
}

export function AreaPage() {
  const { id = "" } = useParams();
  const { data: areas = [] } = useAreas();
  const { data: projects = [] } = useProjects(id);
  const { data: tasks = [] } = useTasks({ area_id: id });
  const qc = useQueryClient();
  const area = areas.find((a) => a.id === id);

  async function addProject() {
    const name = prompt("New project (sprint) name");
    if (!name) return;
    await api.createProject({ name, area_id: id });
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  return (
    <div>
      <Header title={area?.name ?? "Area"} sub="Area" />

      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Projects
          </span>
          <button onClick={addProject} className="text-sm text-sky-400">
            + New project
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {projects.map((p) => (
            <a
              key={p.id}
              href={`/project/${p.id}`}
              className="rounded-lg border border-slate-800 bg-slate-900 p-3 hover:border-slate-700"
            >
              <div className="font-medium">{p.name}</div>
              {p.goal && <div className="text-xs text-slate-500">{p.goal}</div>}
            </a>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-slate-600">No projects yet.</p>
          )}
        </div>
      </div>

      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Loose tasks
      </div>
      <div className="mb-3 max-w-2xl">
        <QuickCapture defaultAreaId={id} />
      </div>
      <TaskList tasks={tasks} empty="No loose tasks in this area." />
    </div>
  );
}

export function ProjectPage() {
  const { id = "" } = useParams();
  const { open } = useTaskUI();
  const { data: projects = [] } = useProjects();
  const project = projects.find((p) => p.id === id);
  if (!project) return <p className="text-slate-500">Loading project...</p>;
  return (
    <div>
      <Header title={project.name} sub={project.goal ?? "Project"} />
      <div className="mb-4 max-w-2xl">
        <QuickCapture defaultProjectId={project.id} defaultAreaId={project.area_id} />
      </div>
      <ProjectBoard project={project} onOpen={open} />
    </div>
  );
}

export function LabelPage() {
  const { name = "" } = useParams();
  const { data: tasks = [] } = useTasks({});
  const filtered = tasks.filter((t) =>
    (t.labels ?? []).some((l) => l.name === decodeURIComponent(name))
  );
  return (
    <div>
      <Header title={`@${decodeURIComponent(name)}`} sub="Label" />
      <TaskList tasks={filtered} empty="No tasks with this label." />
    </div>
  );
}

// ── Settings page ─────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
        {title}
      </h2>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        {children}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { data: pushStatus, refetch: refetchPush } = usePushStatus();
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);

  const swReady = "serviceWorker" in navigator;

  async function revealToken() {
    setTokenBusy(true);
    try {
      const { token } = await api.mcpToken();
      setMcpToken(token);
    } finally {
      setTokenBusy(false);
    }
  }

  async function rotateToken() {
    if (!confirm("Rotate your MCP token? The old one stops working immediately."))
      return;
    setTokenBusy(true);
    try {
      const { token } = await api.mcpTokenRotate();
      setMcpToken(token);
    } finally {
      setTokenBusy(false);
    }
  }

  async function enablePush() {
    if (!swReady) return;
    setPushBusy(true);
    setPushError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setPushError("Notification permission denied.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await api.pushVapidKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      await api.pushSubscribe({
        endpoint: json.endpoint!,
        keys: json.keys as { p256dh: string; auth: string },
      });
      await refetchPush();
    } catch (e) {
      setPushError(String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    if (!swReady) return;
    setPushBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      await refetchPush();
    } catch (e) {
      setPushError(String(e));
    } finally {
      setPushBusy(false);
    }
  }

  const isSubscribed = (pushStatus?.subscriptions ?? 0) > 0;

  return (
    <div className="max-w-xl">
      <Header title="Settings" />

      <Section title="Push notifications">
        {!swReady ? (
          <p className="text-sm text-slate-500">
            Service workers not supported in this browser.
          </p>
        ) : !pushStatus?.configured ? (
          <p className="text-sm text-slate-500">
            Push not configured — run{" "}
            <code className="rounded bg-slate-800 px-1 text-[12px]">
              node scripts/gen-vapid.mjs
            </code>{" "}
            and set <code className="rounded bg-slate-800 px-1 text-[12px]">VAPID_PUBLIC_KEY</code> +{" "}
            <code className="rounded bg-slate-800 px-1 text-[12px]">VAPID_PRIVATE_KEY_JWK</code> as
            wrangler secrets.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Morning brief push{" "}
                <span className={cx("font-medium", isSubscribed ? "text-emerald-400" : "text-slate-500")}>
                  {isSubscribed ? "enabled" : "disabled"}
                </span>
              </p>
              <p className="text-xs text-slate-500">Delivered at 06:00 Brussels time</p>
              {pushError && <p className="mt-1 text-xs text-red-400">{pushError}</p>}
            </div>
            <Button
              variant={isSubscribed ? "ghost" : "primary"}
              className="h-8 text-xs"
              disabled={pushBusy}
              onClick={isSubscribed ? disablePush : enablePush}
            >
              {pushBusy ? "…" : isSubscribed ? "Disable" : "Enable"}
            </Button>
          </div>
        )}
      </Section>

      <Section title="MCP server">
        <p className="mb-2 text-sm text-slate-300">
          Add Checkbox to Claude&apos;s MCP settings to use it from chat. This token
          is yours alone — it identifies your account.
        </p>
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-slate-500">URL</span>
            <code className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-slate-200">
              {location.origin}/mcp
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Token</span>
            {mcpToken ? (
              <code className="rounded bg-slate-800 px-2 py-0.5 text-slate-200 break-all">
                {mcpToken}
              </code>
            ) : (
              <button
                onClick={revealToken}
                className="rounded bg-slate-800 px-2 py-0.5 text-indigo-300 hover:bg-slate-700"
              >
                {tokenBusy ? "…" : "Reveal my token"}
              </button>
            )}
            {mcpToken && (
              <button
                onClick={rotateToken}
                className="rounded px-2 py-0.5 text-slate-500 hover:text-slate-200"
                title="Rotate — invalidates the old token"
              >
                {tokenBusy ? "…" : "rotate"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600">
          16 tools: task CRUD, triage, plan-my-day, daily brief, weekly review.
        </p>
      </Section>

      <Section title="Google Calendar">
        <p className="text-sm text-slate-400">
          Connect or manage your calendar from the{" "}
          <a href="/calendar" className="text-sky-400 hover:underline">
            Calendar page
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
