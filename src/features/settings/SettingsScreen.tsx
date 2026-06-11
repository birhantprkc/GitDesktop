import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { AppSettings } from "@/lib/settings/api";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { AiProviderSection } from "./AiProviderSection";
import { EditorSection } from "./EditorSection";
import { GitSection } from "./GitSection";
import { InstructionsSection } from "./InstructionsSection";
import { TerminalSection } from "./TerminalSection";

/**
 * The slice of AppSettings edited on this screen. Drafted locally and written
 * once via the Save bar; recents and diff view mode are app state owned by
 * other surfaces.
 */
export type SettingsDraft = Omit<AppSettings, "recentRepos" | "diffViewMode">;

export interface SectionProps {
  draft: SettingsDraft;
  update: (patch: Partial<SettingsDraft>) => void;
}

function toDraft(settings: AppSettings): SettingsDraft {
  const { recentRepos, diffViewMode, ...draft } = settings;
  return draft;
}

const PANELS = [
  { id: "ai", label: "AI" },
  { id: "git", label: "Git" },
  { id: "editor", label: "External editor" },
  { id: "terminal", label: "Terminal" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

export function SettingsScreen() {
  const closeSettings = useUiStore((s) => s.closeSettings);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [panel, setPanel] = useState<PanelId>("ai");
  const [confirmClose, setConfirmClose] = useState(false);

  // Seed the draft once settings arrive; afterwards the draft is the source
  // of truth until Save or Discard.
  useEffect(() => {
    if (settings.data && draft === null) setDraft(toDraft(settings.data));
  }, [settings.data, draft]);

  const saved = settings.data ? toDraft(settings.data) : null;
  const dirty =
    draft !== null &&
    saved !== null &&
    JSON.stringify(draft) !== JSON.stringify(saved);

  function update(patch: Partial<SettingsDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function save(onSaved?: () => void) {
    if (!settings.data || !draft) return;
    const branch = draft.defaultBranch.trim() || "main";
    if (branch.startsWith("-") || branch.includes(" ")) {
      toast.error(`"${branch}" is not a valid branch name`);
      setPanel("git");
      return;
    }
    const cleaned = { ...draft, defaultBranch: branch };
    saveSettings.mutate(
      { ...settings.data, ...cleaned },
      {
        onSuccess: () => {
          setDraft(cleaned);
          toast.success("Settings saved");
          onSaved?.();
        },
      },
    );
  }

  function discard() {
    if (saved) setDraft(saved);
  }

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else closeSettings();
  }

  // Esc closes settings (guarded). Base UI popups handle their own Esc and
  // mark the event consumed, so this only fires when nothing else claimed it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) requestClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={requestClose}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="text-sm font-medium">Settings</span>
      </header>

      {draft === null ? (
        <div className="mx-auto w-full max-w-2xl space-y-3 p-6">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className="w-44 shrink-0 space-y-0.5 border-r p-2"
          >
            {PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={panel === p.id ? "page" : undefined}
                className={cn(
                  "block w-full px-2 py-1.5 text-left text-xs",
                  panel === p.id
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                onClick={() => setPanel(p.id)}
              >
                {p.label}
              </button>
            ))}
          </nav>
          <ScrollArea className="min-h-0 flex-1">
            <main className="mx-auto w-full max-w-2xl space-y-8 p-6">
              {panel === "ai" && (
                <>
                  <AiProviderSection draft={draft} update={update} />
                  <InstructionsSection draft={draft} update={update} />
                </>
              )}
              {panel === "git" && <GitSection draft={draft} update={update} />}
              {panel === "editor" && (
                <EditorSection draft={draft} update={update} />
              )}
              {panel === "terminal" && (
                <TerminalSection draft={draft} update={update} />
              )}
            </main>
          </ScrollArea>
        </div>
      )}

      {dirty && (
        <footer
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5"
        >
          <span className="text-xs text-muted-foreground">
            You have unsaved changes
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={discard}>
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => save()}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending && <Spinner data-icon="inline-start" />}
              Save changes
            </Button>
          </div>
        </footer>
      )}

      <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              You have settings changes that haven't been saved yet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClose(false)}>
              Keep editing
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmClose(false);
                closeSettings();
              }}
            >
              Discard and close
            </Button>
            <Button
              onClick={() =>
                save(() => {
                  setConfirmClose(false);
                  closeSettings();
                })
              }
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending && <Spinner data-icon="inline-start" />}
              Save and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
