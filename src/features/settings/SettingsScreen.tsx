import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { useEffect, useEffectEvent, useRef, useState } from "react";
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
import { AutomationsSection } from "@/features/automations/AutomationsSection";
import { useAppForm } from "@/lib/form";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { AccountsSection } from "./AccountsSection";
import { AiProviderSection } from "./AiProviderSection";
import { EditorSection } from "./EditorSection";
import { GeneralSection } from "./GeneralSection";
import { GitIdentitySection, GitSection } from "./GitSection";
import { InstructionsSection } from "./InstructionsSection";
import { KeyboardSection } from "./KeyboardSection";
import { NotificationsSection } from "./NotificationsSection";
import { settingsFormOpts, toDraft } from "./settings-form";
import { TerminalSection } from "./TerminalSection";
import { UpdatesSection } from "./UpdatesSection";

const PANELS = [
  { id: "general", label: "General" },
  { id: "ai", label: "AI" },
  { id: "automations", label: "Automations" },
  { id: "notifications", label: "Notifications" },
  { id: "keyboard", label: "Keyboard" },
  { id: "accounts", label: "Accounts" },
  { id: "git", label: "Git" },
  { id: "editor", label: "External editor" },
  { id: "terminal", label: "Terminal" },
  { id: "updates", label: "Updates" },
] as const;

type PanelId = (typeof PANELS)[number]["id"];

/** Panels that only make sense when AI features are enabled. */
const AI_PANELS = new Set<PanelId>(["ai", "automations"]);

export function SettingsScreen() {
  const closeSettings = useUiStore((s) => s.closeSettings);
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const [panel, setPanel] = useState<PanelId>("general");
  const [confirmClose, setConfirmClose] = useState(false);
  const closeAfterSave = useRef(false);

  // Gating reflects SAVED settings (not the in-progress draft), so panels don't
  // vanish mid-edit while the user is still toggling "Hide AI features".
  const aiEnabled = !settings.data?.hideAi;
  const visiblePanels = PANELS.filter((p) => aiEnabled || !AI_PANELS.has(p.id));
  // Keep a sensible active panel if the current one got hidden.
  const activePanel = visiblePanels.some((p) => p.id === panel)
    ? panel
    : "general";

  const form = useAppForm({
    ...settingsFormOpts,
    onSubmit: async ({ value }) => {
      const current = settings.data;
      if (!current) return;
      const branch = value.defaultBranch.trim() || "main";
      if (branch.startsWith("-") || branch.includes(" ")) {
        toast.error(`"${branch}" is not a valid branch name`);
        setPanel("git");
        closeAfterSave.current = false;
        return;
      }
      const cleaned = { ...value, defaultBranch: branch };
      await saveSettings.mutateAsync({ ...current, ...cleaned });
      // keepDefaultValues everywhere we reset-with-values: otherwise reset
      // rewrites the form's defaultValues and the per-render options sync
      // (which still sees settingsFormOpts' static defaults) clobbers the
      // values right back on the next render.
      form.reset(cleaned, { keepDefaultValues: true });
      toast.success("Settings saved");
      if (closeAfterSave.current) {
        closeAfterSave.current = false;
        closeSettings();
      }
    },
  });

  // Seed the form once settings arrive; afterwards the form is the source
  // of truth until Save or Discard.
  const seeded = useRef(false);
  useEffect(() => {
    if (settings.data && !seeded.current) {
      seeded.current = true;
      form.reset(toDraft(settings.data), { keepDefaultValues: true });
    }
  }, [settings.data, form]);

  // Dirty by value-equality against the persisted settings (not "has been
  // touched"), so typing and undoing leaves the screen clean.
  const values = useSelector(form.store, (s) => s.values);
  const isSubmitting = useSelector(form.store, (s) => s.isSubmitting);
  const saved = settings.data ? toDraft(settings.data) : null;
  const dirty =
    seeded.current &&
    saved !== null &&
    JSON.stringify(values) !== JSON.stringify(saved);

  function save(andClose: boolean) {
    closeAfterSave.current = andClose;
    form.handleSubmit();
  }

  function discard() {
    if (saved) form.reset(saved, { keepDefaultValues: true });
  }

  function requestClose() {
    if (dirty) setConfirmClose(true);
    else closeSettings();
  }

  // Esc closes settings (guarded). Base UI popups handle their own Esc and
  // mark the event consumed, so this only fires when nothing else claimed it.
  // An effect event so the listener reads the current dirty state without
  // re-subscribing on every render.
  const onEscape = useEffectEvent(() => requestClose());
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onEscape();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

      {settings.isPending ? (
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
            {visiblePanels.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={activePanel === p.id ? "page" : undefined}
                className={cn(
                  "block w-full px-2 py-1.5 text-left text-xs",
                  activePanel === p.id
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
              {activePanel === "general" && <GeneralSection form={form} />}
              {activePanel === "ai" && (
                <>
                  <AiProviderSection form={form} />
                  <InstructionsSection form={form} />
                </>
              )}
              {activePanel === "automations" && <AutomationsSection />}
              {activePanel === "notifications" && (
                <NotificationsSection form={form} />
              )}
              {activePanel === "keyboard" && <KeyboardSection form={form} />}
              {activePanel === "accounts" && <AccountsSection />}
              {activePanel === "git" && (
                <>
                  <GitSection form={form} />
                  <GitIdentitySection />
                </>
              )}
              {activePanel === "editor" && <EditorSection form={form} />}
              {activePanel === "terminal" && <TerminalSection form={form} />}
              {activePanel === "updates" && <UpdatesSection form={form} />}
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
              onClick={() => save(false)}
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner data-icon="inline-start" />}
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
                discard();
                closeSettings();
              }}
            >
              Discard and close
            </Button>
            <Button
              onClick={() => {
                setConfirmClose(false);
                save(true);
              }}
              disabled={isSubmitting}
            >
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Save and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
