import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAttachments } from "../lib/queries";
import {
  AttachIcon,
  LinkIcon,
  UploadIcon,
  TrashIcon,
  ExternalLinkIcon,
} from "../lib/icons";

// Attachments for a task: R2-backed file uploads plus plain link attachments.
// File upload degrades gracefully — a 501 (no bucket bound) surfaces an inline
// note and the user can still attach links.
export function AttachmentList({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const { data: attachments = [] } = useAttachments(taskId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["attachments", taskId] });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      await api.uploadAttachment(taskId, file);
      invalidate();
    } catch (ex) {
      const s = String(ex);
      setErr(
        s.includes("501")
          ? "File storage isn't set up — attach a link instead."
          : s.includes("507")
          ? "Storage limit reached (free-tier guard) — delete some files or attach a link."
          : s.includes("413")
          ? "File too large (max 25 MB)."
          : "Upload failed."
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    setBusy(true);
    try {
      await api.addLinkAttachment(taskId, linkUrl.trim());
      setLinkUrl("");
      setShowLink(false);
      invalidate();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteAttachment(taskId, id);
    invalidate();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <AttachIcon className="h-3.5 w-3.5" /> Attachments
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setShowLink((s) => !s)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <LinkIcon className="h-3.5 w-3.5" /> Link
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <UploadIcon className="h-3.5 w-3.5" /> Upload
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={onFile}
          />
        </div>
      </div>

      {showLink && (
        <div className="mt-2 flex gap-2">
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
            placeholder="https://…"
            className="h-8 flex-1 rounded-md border border-input bg-surface px-2 text-sm text-foreground outline-none focus:border-primary"
            autoFocus
          />
          <button
            onClick={addLink}
            className="rounded-md bg-surface-2 px-2 text-xs text-foreground hover:bg-surface-2/70"
          >
            Add
          </button>
        </div>
      )}

      {err && <p className="mt-1.5 text-[11px] text-warning">{err}</p>}

      <div className="mt-2 space-y-1">
        {attachments.map((a) => (
          <div
            key={a.id}
            className="group flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-sm"
          >
            {a.kind === "link" ? (
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
            ) : (
              <AttachIcon className="h-3.5 w-3.5 shrink-0 text-subtle" />
            )}
            <a
              href={
                a.kind === "link" ? a.url : `/api/attachments/file/${a.id}`
              }
              target="_blank"
              rel="noreferrer"
              className="flex flex-1 items-center gap-1 truncate text-foreground hover:text-primary"
            >
              <span className="truncate">{a.filename ?? a.url}</span>
              <ExternalLinkIcon className="h-3 w-3 shrink-0 text-subtle" />
            </a>
            <button
              onClick={() => remove(a.id)}
              aria-label="Delete attachment"
              className="hidden shrink-0 text-subtle hover:text-danger group-hover:block"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
