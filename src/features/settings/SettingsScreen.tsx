import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { AiProviderSection } from "./AiProviderSection";
import { EditorSection } from "./EditorSection";
import { InstructionsSection } from "./InstructionsSection";

export function SettingsScreen() {
  const closeSettings = useUiStore((s) => s.closeSettings);
  const settings = useSettings();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={closeSettings}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="text-sm font-medium">Settings</span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <main className="mx-auto w-full max-w-2xl space-y-8 p-6">
          {settings.isPending || !settings.data ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <AiProviderSection settings={settings.data} />
              <InstructionsSection settings={settings.data} />
              <EditorSection settings={settings.data} />
            </>
          )}
        </main>
      </ScrollArea>
    </div>
  );
}
