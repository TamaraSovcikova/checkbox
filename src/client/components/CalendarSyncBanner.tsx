import type { CalendarStatus } from "../../shared/types";

// Google Calendar sync can be broken in two very different ways, and the fix for
// one does nothing for the other. Say which, and what to do about it, rather than
// letting writes silently never reach Google.
export function CalendarSyncBanner({ status }: { status: CalendarStatus }) {
  if (!status.connected || !status.sync_broken) return null;

  const apiDisabled = status.error_kind === "api_disabled";
  const auth = status.error_kind === "auth";

  return (
    <div className="rounded-lg border border-danger/40 bg-danger/5 p-3">
      <p className="text-sm font-medium text-foreground">
        {apiDisabled
          ? "Google Calendar API is not enabled"
          : auth
          ? "Google Calendar needs reconnecting"
          : "Google Calendar sync is failing"}
      </p>

      <p className="mt-0.5 text-xs text-muted">
        {apiDisabled ? (
          <>
            Your account is connected, but the Calendar API is switched off on the
            Google Cloud project, so no time-blocks reach your calendar and no events
            come back. Enable it, wait a minute, then hit Sync. Reconnecting will not
            help.
          </>
        ) : auth ? (
          <>
            Google reports the saved token is expired or revoked. Reconnect to fix it.
            If it breaks again about every 7 days, publish the OAuth consent screen
            (apps left in "Testing" expire tokens after 7 days).
          </>
        ) : (
          <>Google rejected the last calendar request. Details below.</>
        )}
      </p>

      {status.last_error && (
        <pre className="mt-2 max-h-24 overflow-auto rounded bg-surface-2/60 p-2 text-[10px] leading-snug text-subtle">
          {status.last_error.slice(0, 400)}
        </pre>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {apiDisabled && status.activation_url && (
          <a
            href={status.activation_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Enable Calendar API
          </a>
        )}
        {!apiDisabled && (
          <a
            href="/api/calendar/connect"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Reconnect
          </a>
        )}
      </div>
    </div>
  );
}
