import { useState } from "react";
import type { ReactNode } from "react";
import {
  usePushStatus,
  useCalendarStatus,
  useCalendarFeeds,
  useSetCalendarFeed,
  useGmailStatus,
  useGmailRefresh,
  useViewPrefs,
  useAreas,
} from "./lib/queries";
import { useMe } from "./lib/ui-context";
import {
  useTheme,
  PALETTES,
  FONTS,
  type ThemePref,
  type PaletteInfo,
} from "./lib/theme";
import { CalendarSyncBanner } from "./components/CalendarSyncBanner";
import { InstallHint } from "./components/InstallHint";
import { Header } from "./components/PageHeader";
import { Button, cx } from "./components/ui";
import { api } from "./lib/api";

// Convert a base64url VAPID key to the Uint8Array the Push API expects.
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
  children: ReactNode;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-subtle">
        {title}
      </h2>
      <div className="rounded-xl border border-border bg-surface/40 p-5">
        {children}
      </div>
    </div>
  );
}

// Catch-all area for backlog tasks triage cannot confidently place. Without one,
// an unmatched ad-hoc task has no home and triage just shrugs.
function TriageSection() {
  const { data: areas = [] } = useAreas();
  const { prefs, setTriageFallbackArea } = useViewPrefs();
  const current = prefs.triageFallbackAreaId ?? "";

  return (
    <Section title="Triage">
      <label className="block text-sm text-foreground">
        Catch-all area
        <p className="mt-0.5 mb-2 text-xs text-subtle">
          When triage cannot confidently match a backlog task (an ad-hoc task, say),
          it suggests this area instead of giving up.
        </p>
        <select
          value={current}
          onChange={(e) => setTriageFallbackArea(e.target.value || null)}
          className="w-full max-w-sm rounded-md border border-input bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
        >
          <option value="">None (leave unmatched)</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </Section>
  );
}

// Small on/off switch, shared by the settings toggles.
function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-surface-2"
      )}
    >
      <span
        className={cx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

// One scheme swatch. A full theme previews as its accent sitting on its own
// background, which is the thing that actually differs; an accent is just a dot.
function PaletteButton({
  info,
  active,
  onPick,
}: {
  info: PaletteInfo;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={info.label}
      aria-pressed={active}
      title={info.label}
      className={cx(
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "border-primary bg-surface-2 text-foreground"
          : "border-border text-muted hover:text-foreground"
      )}
    >
      {info.bg ? (
        <span
          className="grid h-4 w-4 shrink-0 place-items-center rounded border border-black/20"
          style={{ background: info.bg }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: info.swatch }}
          />
        </span>
      ) : (
        <span
          className="h-4 w-4 shrink-0 rounded-full"
          style={{ background: info.swatch }}
        />
      )}
      {info.label}
    </button>
  );
}

function AppearanceSection() {
  const { pref, resolved, setPref, palette, setPalette, font, setFont } = useTheme();
  const { dimDistantTasks, setDimDistantTasks } = useViewPrefs();
  const opts: { value: ThemePref; label: string }[] = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  return (
    <Section title="Appearance">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Mode</div>
          <div className="text-xs text-subtle">
            {pref === "system"
              ? `Following your system (${resolved})`
              : `Always ${pref}`}
          </div>
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-surface-2/40 p-0.5">
          {opts.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setPref(o.value)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (pref === o.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground")
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Themes: full palettes. Accents: a colour on the default look. */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="text-sm text-foreground">Theme</div>
        <div className="text-xs text-subtle">
          A full palette: its own background, surfaces and text. Each has a light and
          a dark version, so it follows your mode above.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PALETTES.filter((p) => p.kind === "theme").map((p) => (
            <PaletteButton
              key={p.key}
              info={p}
              active={palette === p.key}
              onPick={() => setPalette(p.key)}
            />
          ))}
        </div>

        <div className="mt-4 text-sm text-foreground">Accent</div>
        <div className="text-xs text-subtle">
          Keeps the default look and recolours it.
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PALETTES.filter((p) => p.kind === "accent").map((p) => (
            <PaletteButton
              key={p.key}
              info={p}
              active={palette === p.key}
              onPick={() => setPalette(p.key)}
            />
          ))}
        </div>
      </div>

      {/* Font: system stacks only, so it stays offline-safe. */}
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Font</div>
          <div className="text-xs text-subtle">The typeface used across the app.</div>
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-surface-2/40 p-0.5">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFont(f.key)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (font === f.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="min-w-0">
          <div className="text-sm text-foreground">Dim distant tasks</div>
          <div className="text-xs text-subtle">
            Grey out tasks due more than a month away. They stay fully usable, just
            quieter, so the far future doesn&apos;t pull your eye.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={dimDistantTasks}
          aria-label="Dim distant tasks"
          onClick={() => setDimDistantTasks(!dimDistantTasks)}
          className={cx(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            dimDistantTasks ? "bg-primary" : "bg-surface-2"
          )}
        >
          <span
            className={cx(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform",
              dimDistantTasks ? "translate-x-[22px]" : "translate-x-0.5"
            )}
          />
        </button>
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const me = useMe();
  const { data: pushStatus, refetch: refetchPush } = usePushStatus();
  const { data: cal, refetch: refetchCal } = useCalendarStatus();
  const { data: calFeeds } = useCalendarFeeds(!!cal?.connected);
  const setCalFeed = useSetCalendarFeed();
  const { gcalSyncTimeBlocks, gcalSyncDueDates, setGcalSync } = useViewPrefs();
  const { data: gmail, refetch: refetchGmail } = useGmailStatus();
  const gmailRefresh = useGmailRefresh();
  const [gmailBusy, setGmailBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [mcpToken, setMcpToken] = useState<string | null>(null);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [calBusy, setCalBusy] = useState(false);

  const swReady = "serviceWorker" in navigator;

  async function disconnectCal() {
    if (!confirm("Disconnect Google Calendar? Synced events will be cleared."))
      return;
    setCalBusy(true);
    try {
      await api.calendarDisconnect();
      await refetchCal();
    } finally {
      setCalBusy(false);
    }
  }

  async function disconnectGmail() {
    if (!confirm("Disconnect Gmail? Coverage rows already recorded are kept."))
      return;
    setGmailBusy(true);
    try {
      await api.gmailDisconnect();
      await refetchGmail();
    } finally {
      setGmailBusy(false);
    }
  }

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
    setPushError(null);
    try {
      // Unhook this browser if it holds a subscription, but do not depend on
      // it: the enabled label counts rows from EVERY device, so the sub may
      // live elsewhere (or be stale). Disable means all of them go.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await api.pushUnsubscribeAll();
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

      <InstallHint dismissible={false} />

      <Section title="Account">
        <div className="flex items-center gap-3">
          {me?.avatar ? (
            <img
              src={me.avatar}
              alt=""
              className="h-10 w-10 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-sm font-medium text-foreground">
              {(me?.name || me?.email || "?").trim().charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm text-foreground">
              {me?.name ?? "Signed in"}
            </div>
            <div className="truncate text-xs text-subtle">{me?.email}</div>
          </div>
        </div>
      </Section>

      <AppearanceSection />

      <TriageSection />

      <Section title="Notifications">
        {!swReady ? (
          <p className="text-sm text-muted">
            Service workers not supported in this browser.
          </p>
        ) : !pushStatus?.configured ? (
          <p className="text-sm text-muted">
            Push not configured. Run{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">
              node scripts/gen-vapid.mjs
            </code>{" "}
            and set{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">VAPID_PUBLIC_KEY</code> +{" "}
            <code className="rounded bg-surface-2 px-1 text-[12px]">VAPID_PRIVATE_KEY_JWK</code>{" "}
            as wrangler secrets.
          </p>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">
                Morning brief push{" "}
                <span
                  className={cx(
                    "font-medium",
                    isSubscribed ? "text-success" : "text-subtle"
                  )}
                >
                  {isSubscribed ? "enabled" : "disabled"}
                </span>
              </p>
              <p className="text-xs text-subtle">Delivered at 06:00 Brussels time</p>
              {pushError && <p className="mt-1 text-xs text-danger">{pushError}</p>}
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

      <Section title="Google Calendar">
        {cal && (
          <div className="mb-4 empty:mb-0">
            <CalendarSyncBanner status={cal} />
          </div>
        )}
        {cal?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                Connected <span className="text-subtle">· {cal.google_email}</span>
              </p>
              <p className="text-xs text-subtle">
                Two-way task sync, and all your calendars shown as a backdrop.
                Reconnect if your other calendars aren't appearing.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="subtle"
                className="h-8 text-xs"
                onClick={() => {
                  window.location.href = "/calendar";
                }}
              >
                Open
              </Button>
              <Button
                variant="subtle"
                className="h-8 text-xs"
                onClick={() => {
                  window.location.href = "/api/calendar/connect";
                }}
              >
                Reconnect
              </Button>
              <Button
                variant="ghost"
                className="h-8 text-xs text-danger hover:bg-danger/10"
                disabled={calBusy}
                onClick={disconnectCal}
              >
                {calBusy ? "…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              Connect to see meetings as a backdrop and drag tasks onto a timeline.
            </p>
            <Button
              variant="primary"
              className="h-8 shrink-0 text-xs"
              onClick={() => {
                window.location.href = "/api/calendar/connect";
              }}
            >
              Connect
            </Button>
          </div>
        )}

        {/* Which calendars show up on the grid. */}
        {cal?.connected && calFeeds && calFeeds.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="text-sm text-foreground">Calendars to show</div>
            <div className="text-xs text-subtle">
              Pick which Google calendars appear as a backdrop on the timeline.
            </div>
            <div className="mt-1 space-y-1.5">
              {calFeeds.map((f) => (
                <div
                  key={f.calendar_id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: f.color ?? "var(--muted)" }}
                    />
                    <span className="truncate text-sm text-foreground">
                      {f.summary ?? f.calendar_id}
                    </span>
                    {f.primary && (
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-subtle">
                        primary
                      </span>
                    )}
                  </div>
                  <Switch
                    label={`Show ${f.summary ?? f.calendar_id}`}
                    checked={f.enabled}
                    disabled={f.primary || setCalFeed.isPending}
                    onChange={(v) =>
                      setCalFeed.mutate({ id: f.calendar_id, enabled: v })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What Checkbox pushes to Google Calendar. */}
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-foreground">Sync time-blocked tasks</div>
              <div className="text-xs text-subtle">
                Tasks you give a time block show as timed events.
              </div>
            </div>
            <Switch
              label="Sync time-blocked tasks"
              checked={gcalSyncTimeBlocks}
              onChange={(v) => setGcalSync({ gcalSyncTimeBlocks: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-foreground">Sync due-dated tasks</div>
              <div className="text-xs text-subtle">
                Tasks with a due date show as all-day events. Turn off to keep due
                dates in Checkbox only and declutter your calendar.
              </div>
            </div>
            <Switch
              label="Sync due-dated tasks"
              checked={gcalSyncDueDates}
              onChange={(v) => setGcalSync({ gcalSyncDueDates: v })}
            />
          </div>
          <p className="text-[11px] text-subtle">
            Takes effect as tasks are next created or edited; existing events
            reconcile on the next sync.
          </p>
        </div>
      </Section>

      <Section title="Gmail">
        {gmail?.sync_broken && gmail.last_error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
            Gmail sync is broken. Reconnect. <span className="opacity-70">{gmail.last_error}</span>
          </div>
        )}
        {gmail?.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                Connected <span className="text-subtle">· {gmail.google_email}</span>
              </p>
              <p className="text-xs text-subtle">
                Live coverage pull.{" "}
                {gmail.last_sync_at
                  ? `Last refreshed ${gmail.last_sync_at.slice(0, 16).replace("T", " ")}`
                  : "Not refreshed yet"}
                .
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="subtle"
                className="h-8 text-xs"
                disabled={gmailRefresh.isPending}
                onClick={() => gmailRefresh.mutate()}
              >
                {gmailRefresh.isPending ? "Refreshing…" : "Refresh now"}
              </Button>
              <Button
                variant="ghost"
                className="h-8 text-xs text-danger hover:bg-danger/10"
                disabled={gmailBusy}
                onClick={disconnectGmail}
              >
                {gmailBusy ? "…" : "Disconnect"}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Connect Gmail to refresh Mail coverage live, instead of waiting for
                the planner&apos;s next run. Checkbox never sends mail.
              </p>
              <Button
                variant="primary"
                className="h-8 shrink-0 text-xs"
                onClick={() => {
                  window.location.href = "/api/gmail/connect";
                }}
              >
                Connect
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              One-time Google Cloud setup: add the scope{" "}
              <code className="rounded bg-surface-2 px-1">gmail.modify</code> to your
              OAuth consent screen, and add{" "}
              <code className="rounded bg-surface-2 px-1">
                {location.origin}/api/gmail/callback
              </code>{" "}
              as an authorised redirect URI.
            </p>
          </div>
        )}
      </Section>

      <Section title="Integrations">
        <p className="mb-2 text-sm text-foreground">
          Add Checkbox to Claude&apos;s MCP settings to use it from chat. This token
          is yours alone, it identifies your account.
        </p>
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-subtle">URL</span>
            <code className="ml-2 rounded bg-surface-2 px-2 py-0.5 text-foreground">
              {location.origin}/mcp
            </code>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-subtle">Token</span>
            {mcpToken ? (
              <code className="break-all rounded bg-surface-2 px-2 py-0.5 text-foreground">
                {mcpToken}
              </code>
            ) : (
              <button
                onClick={revealToken}
                className="rounded bg-surface-2 px-2 py-0.5 text-primary hover:bg-surface-2/70"
              >
                {tokenBusy ? "…" : "Reveal my token"}
              </button>
            )}
            {mcpToken && (
              <button
                onClick={rotateToken}
                className="rounded px-2 py-0.5 text-subtle hover:text-foreground"
                title="Rotate: invalidates the old token"
              >
                {tokenBusy ? "…" : "rotate"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-subtle">
          Task CRUD, triage, plan-my-day, daily brief, weekly review, vault sync.
        </p>
      </Section>

      <Section title="Data">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">Export everything</p>
            <p className="text-xs text-subtle">
              Your complete data (tasks, areas, cards, trackers, coverage) as one
              JSON file. Your data is yours.
            </p>
          </div>
          <Button
            variant="subtle"
            className="h-8 shrink-0 text-xs"
            onClick={() => {
              window.location.href = "/api/export";
            }}
          >
            Download my data
          </Button>
        </div>
      </Section>
    </div>
  );
}
