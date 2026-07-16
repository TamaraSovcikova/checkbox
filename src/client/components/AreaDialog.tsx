import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import type { Area } from "../../shared/types";
import { api } from "../lib/api";
import { AREA_COLORS } from "../lib/colors";
import { PALETTES } from "../lib/theme";
import { AREA_ICONS, CloseIcon, CheckIcon, TrashIcon } from "../lib/icons";
import { Button, Input } from "./ui";
import { cn } from "@/lib/utils";

// Create or edit an area with a color + icon for at-a-glance scanning. Colors
// and icons both come from the token/icon vocabulary (lib/colors, lib/icons).
export function AreaDialog({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing?: Area;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setColor(existing?.color ?? "indigo");
      setIcon(existing?.icon ?? null);
      setPalette(existing?.palette ?? null);
      setBanner(existing?.banner ?? null);
      setUploadError(null);
      setConfirmDelete(false);
    }
  }, [open, existing]);

  async function remove() {
    if (!existing) return;
    setBusy(true);
    try {
      await api.deleteArea(existing.id);
      // Deleting an area unfiles (does not delete) its tasks and projects.
      qc.invalidateQueries({ queryKey: ["areas"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["view"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onOpenChange(false);
      if (window.location.pathname === `/area/${existing.id}`) navigate("/today");
    } finally {
      setBusy(false);
    }
  }

  // Uploading needs an area id to key the R2 object on, so it is only offered on
  // an existing area. A new one gets a banner on its second visit to this dialog.
  async function pickFile(file: File) {
    if (!existing) return;
    setBusy(true);
    setUploadError(null);
    try {
      const { banner: url } = await api.uploadAreaBanner(existing.id, file);
      // Cache-bust: the URL is stable across re-uploads, so without this the
      // browser would keep showing the image you just replaced.
      setBanner(`${url}?v=${Date.now()}`);
      qc.invalidateQueries({ queryKey: ["areas"] });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), color, icon, palette, banner };
      if (existing) await api.updateArea(existing.id, body);
      else await api.createArea(body);
      qc.invalidateQueries({ queryKey: ["areas"] });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-foreground">
              {existing ? "Edit area" : "New area"}
            </Dialog.Title>
            <Dialog.Close className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground">
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <label className="block text-xs text-muted">
            Name
            <div className="mt-1">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="e.g. Health, Work, Home"
                autoFocus
              />
            </div>
          </label>

          <div className="mt-4">
            <span className="text-xs text-muted">Color</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {AREA_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  title={c.label}
                  aria-label={c.label}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110",
                    color === c.key && "ring-2 ring-offset-2 ring-offset-surface"
                  )}
                  style={{
                    background: c.var,
                    // ring uses the same hue
                    ["--tw-ring-color" as string]: c.var,
                  }}
                >
                  {color === c.key && (
                    <CheckIcon className="h-3.5 w-3.5 text-black/70" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <span className="text-xs text-muted">Icon</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setIcon(null)}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-md border text-[11px] text-muted transition-colors",
                  icon === null
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border hover:bg-surface-2"
                )}
              >
                none
              </button>
              {Object.entries(AREA_ICONS).map(([key, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  aria-label={key}
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-md border transition-colors",
                    icon === key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted hover:bg-surface-2"
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <span className="text-xs text-muted">Theme</span>
            <p className="mb-1.5 mt-0.5 text-[11px] text-subtle">
              Just this area&rsquo;s page. Leave on App to follow your global theme.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPalette(null)}
                className={cn(
                  "h-7 rounded-md border px-2 text-[11px] transition-colors",
                  palette === null
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted hover:bg-surface-2"
                )}
              >
                App
              </button>
              {PALETTES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPalette(p.key)}
                  title={p.label}
                  aria-label={p.label}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-md border transition-transform hover:scale-110",
                    palette === p.key ? "border-primary" : "border-border"
                  )}
                  // Full themes preview as accent-on-their-own-background; accents
                  // have no background of their own, so they show as a plain swatch.
                  style={{ background: p.bg ?? p.swatch }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: p.swatch }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <span className="text-xs text-muted">Banner</span>
            {banner && (
              <div className="relative mt-1.5 overflow-hidden rounded-md border border-border">
                <img src={banner} alt="" className="h-20 w-full object-cover" />
                <button
                  type="button"
                  title="Remove banner"
                  aria-label="Remove banner"
                  onClick={async () => {
                    // A stored upload has bytes in R2 to reclaim; a pasted link
                    // has nothing but the field, so just clear it.
                    if (existing && banner.startsWith("/api/")) {
                      await api.deleteAreaBanner(existing.id);
                      qc.invalidateQueries({ queryKey: ["areas"] });
                    }
                    setBanner(null);
                  }}
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded bg-black/50 text-white hover:bg-black/70"
                >
                  <TrashIcon className="h-3 w-3" />
                </button>
              </div>
            )}
            <div className="mt-1.5 flex gap-1.5">
              <Input
                value={banner?.startsWith("/api/") ? "" : banner ?? ""}
                onChange={(e) => setBanner(e.target.value.trim() || null)}
                placeholder={
                  banner?.startsWith("/api/") ? "Uploaded image" : "Paste an image URL"
                }
                disabled={banner?.startsWith("/api/")}
              />
              <label
                className={cn(
                  "grid h-9 shrink-0 cursor-pointer place-items-center rounded-md border border-border px-2.5 text-xs text-muted transition-colors hover:bg-surface-2",
                  !existing && "pointer-events-none opacity-50"
                )}
                title={
                  existing ? "Upload an image" : "Save the area first, then upload"
                }
              >
                Upload
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) pickFile(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {uploadError && (
              <p className="mt-1 text-[11px] text-danger">{uploadError}</p>
            )}
          </div>

          {confirmDelete ? (
            <div className="mt-5 rounded-lg border border-danger/40 bg-danger/5 p-3">
              <p className="text-sm text-foreground">Delete this area?</p>
              <p className="mt-0.5 text-xs text-subtle">
                Its tasks and projects are kept and become unfiled (moved to Backlog).
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={remove} disabled={busy}>
                  {busy ? "Deleting…" : "Delete area"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 flex items-center gap-2">
              {existing && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-sm text-danger transition-colors hover:text-danger/80"
                >
                  Delete
                </button>
              )}
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
                  {existing ? "Save" : "Create area"}
                </Button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
