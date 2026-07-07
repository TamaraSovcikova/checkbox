import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import type { Area } from "../../shared/types";
import { api } from "../lib/api";
import { AREA_COLORS } from "../lib/colors";
import { AREA_ICONS, CloseIcon, CheckIcon } from "../lib/icons";
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
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(existing?.name ?? "");
      setColor(existing?.color ?? "indigo");
      setIcon(existing?.icon ?? null);
    }
  }, [open, existing]);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), color, icon };
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

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || busy}>
              {existing ? "Save" : "Create area"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
