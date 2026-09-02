import { useState } from "react";
import type { Template } from "../../shared/types";
import { useTemplates, useApplyTemplate, useDeleteTemplate } from "../lib/queries";
import { useToast } from "../lib/toast";
import { TemplateDialog } from "./TemplateDialog";
import { TemplateIcon, AddIcon, MoreIcon } from "../lib/icons";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./ui/dropdown-menu";

function SectionHeader({
  title,
  action,
  onMove,
}: {
  title: string;
  action?: React.ReactNode;
  // Section reordering, passed down from the sidebar (see Sidebar SectionMove).
  onMove?: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-center justify-between px-2">
      <span className="text-xs font-medium uppercase tracking-wide text-subtle">
        {title}
      </span>
      <div className="flex items-center gap-0.5">
        {onMove}
        {action}
      </div>
    </div>
  );
}

// Sidebar "Templates" section. Click a template to expand it into tasks anchored
// to today; the ⋯ menu edits or deletes. Add opens the builder dialog.
export function TemplatesSection({ move }: { move?: React.ReactNode }) {
  const { data: templates = [] } = useTemplates();
  const apply = useApplyTemplate();
  const del = useDeleteTemplate();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | undefined>(undefined);

  async function runApply(t: Template) {
    const res = await apply.mutateAsync({ id: t.id });
    toast(`Added ${res.created} task${res.created !== 1 ? "s" : ""} from "${t.name}"`);
  }

  return (
    <>
      <div className="mt-5" />
      <SectionHeader
        title="Templates"
        onMove={move}
        action={
          <button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
            title="New template"
            className="grid h-5 w-5 place-items-center rounded text-subtle hover:bg-surface-2 hover:text-foreground"
          >
            <AddIcon className="h-3.5 w-3.5" />
          </button>
        }
      />
      <div className="space-y-0.5">
        {templates.map((t) => (
          <div key={t.id} className="group flex items-center">
            <button
              onClick={() => runApply(t)}
              disabled={apply.isPending}
              title={`Apply "${t.name}" (${t.items?.length ?? 0} tasks) to today`}
              className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2/60 hover:text-foreground"
            >
              <TemplateIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t.name}</span>
              <span className="ml-auto text-[11px] text-subtle">
                {t.items?.length ?? 0}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Manage ${t.name}`}
                  className="mr-1 hidden h-6 w-6 shrink-0 place-items-center rounded text-subtle hover:text-foreground group-hover:grid data-[state=open]:grid"
                >
                  <MoreIcon className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => runApply(t)}>
                  Apply to today
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setEditing(t);
                    setDialogOpen(true);
                  }}
                >
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    if (confirm(`Delete template "${t.name}"?`)) del.mutate(t.id);
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {templates.length === 0 && (
          <button
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
            className="w-full rounded-md border border-dashed border-border px-2 py-1.5 text-left text-xs text-subtle hover:border-primary/50 hover:text-foreground"
          >
            + New template (e.g. Trip prep)
          </button>
        )}
      </div>
      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existing={editing}
      />
    </>
  );
}
