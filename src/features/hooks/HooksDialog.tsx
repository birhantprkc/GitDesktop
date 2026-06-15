import { CaretDownIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteHook,
  useHookContent,
  useHooks,
  useSetHookEnabled,
  useWriteHook,
} from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { HOOK_TEMPLATES } from "./templates";

const DEFAULT_HOOK = "#!/bin/sh\n\n";

export function HooksDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hooks = useHooks(repoPath);
  const writeHook = useWriteHook(repoPath);
  const setEnabled = useSetHookEnabled(repoPath);
  const deleteHook = useDeleteHook(repoPath);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const content = useHookContent(repoPath, selected);

  const entries = hooks.data?.entries ?? [];
  const entry = entries.find((e) => e.name === selected) ?? null;
  const templates = HOOK_TEMPLATES.filter((t) => t.hook === selected);

  // Seed the editor when a hook is selected and its content resolves (falling
  // back to git's sample, then a bare shebang for a brand-new hook).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    if (selected === null) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current !== selected && content.isSuccess) {
      seededFor.current = selected;
      setDraft(content.data ?? DEFAULT_HOOK);
      setConfirmDelete(false);
    }
  }, [selected, content.isSuccess, content.data]);

  const original = content.data ?? DEFAULT_HOOK;
  const dirty = draft !== original;
  const isBlank = draft.trim() === "";
  const noShebang = !isBlank && !draft.startsWith("#!");
  const canSave =
    entry !== null && !isBlank && (dirty || entry.state === "inactive");

  function save() {
    if (!entry) return;
    writeHook.mutate(
      { name: entry.name, content: draft },
      {
        onSuccess: () => toast.success(`Saved the ${entry.name} hook`),
        onError: toastError,
      },
    );
  }

  function toggle(enabled: boolean) {
    if (!entry) return;
    setEnabled.mutate(
      { name: entry.name, enabled },
      {
        onSuccess: () =>
          toast.success(`${enabled ? "Enabled" : "Disabled"} ${entry.name}`),
        onError: toastError,
      },
    );
  }

  function doDelete() {
    if (!entry) return;
    deleteHook.mutate(entry.name, {
      onSuccess: () => {
        toast.success(`Deleted ${entry.name}`);
        setSelected(null);
      },
      onError: toastError,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Git hooks</DialogTitle>
          <DialogDescription>
            Scripts git runs around commits, merges, and pushes. They live in
            this repo's hooks directory and run locally — they aren't committed
            or shared. Each needs an executable script (a{" "}
            <span className="font-mono">#!/bin/sh</span> shebang).
          </DialogDescription>
        </DialogHeader>

        {(hooks.data?.manager || hooks.data?.customHooksPath) && (
          <div className="flex items-start gap-2 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {hooks.data?.manager
                ? `This repository uses ${hooks.data.manager} to manage hooks — editing here may conflict with it.`
                : `Hooks run from ${hooks.data?.hooksPath} (core.hooksPath).`}
            </span>
          </div>
        )}

        {hooks.isPending ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <div className="flex h-112 gap-3">
            <ScrollArea className="w-52 shrink-0 border-r pr-2">
              <div className="space-y-0.5">
                {entries.map((e) => (
                  <button
                    key={e.name}
                    type="button"
                    onClick={() => setSelected(e.name)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs",
                      selected === e.name
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-muted/60",
                    )}
                  >
                    <span className="truncate font-mono">{e.name}</span>
                    {e.state === "active" && (
                      <span className="shrink-0 text-[10px] text-green-600 dark:text-green-400">
                        Active
                      </span>
                    )}
                    {e.state === "disabled" && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        Off
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>

            <div className="flex min-w-0 flex-1 flex-col">
              {entry === null ? (
                <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
                  Select a hook to view or edit it.
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                    {templates.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="outline" size="xs">
                              Templates
                              <CaretDownIcon data-icon="inline-end" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="w-80">
                          {templates.map((t) => (
                            <DropdownMenuItem
                              key={t.id}
                              onClick={() => setDraft(t.body)}
                              className="flex flex-col items-start gap-0.5 whitespace-normal py-2"
                            >
                              <span className="font-medium">{t.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {t.description}
                              </span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="relative min-h-0 flex-1">
                    <div className="absolute inset-0">
                      <CodeEditor value={draft} onChange={setDraft} />
                    </div>
                  </div>
                  {noShebang && (
                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      No shebang line (e.g.{" "}
                      <span className="font-mono">#!/bin/sh</span>) — git may
                      not run this hook.
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={save}
                      disabled={!canSave || writeHook.isPending}
                    >
                      {entry.state === "inactive" ? "Create hook" : "Save"}
                    </Button>
                    {entry.state === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggle(false)}
                        disabled={setEnabled.isPending}
                      >
                        Disable
                      </Button>
                    )}
                    {entry.state === "disabled" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggle(true)}
                        disabled={setEnabled.isPending}
                      >
                        Enable
                      </Button>
                    )}
                    <span className="flex-1" />
                    {entry.state !== "inactive" &&
                      (confirmDelete ? (
                        <>
                          <span className="text-xs text-muted-foreground">
                            Recycle bin?
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmDelete(false)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={doDelete}
                            disabled={deleteHook.isPending}
                          >
                            Delete
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(true)}
                        >
                          Delete…
                        </Button>
                      ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
