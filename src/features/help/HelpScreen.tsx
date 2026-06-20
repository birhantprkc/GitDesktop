import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { GUIDE_SECTIONS } from "./content";

export function HelpScreen() {
  const closeHelp = useUiStore((s) => s.closeHelp);
  const [sectionId, setSectionId] = useState(GUIDE_SECTIONS[0].id);
  const active =
    GUIDE_SECTIONS.find((s) => s.id === sectionId) ?? GUIDE_SECTIONS[0];

  // Esc closes the guide. Guarded so Base UI popups (which mark the event
  // consumed) get first claim; an effect event reads the latest closeHelp.
  const onEscape = useEffectEvent(() => closeHelp());
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) onEscape();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back"
          onClick={closeHelp}
        >
          <ArrowLeftIcon />
        </Button>
        <span className="text-sm font-medium">User guide</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label="Guide sections"
          className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r p-2"
        >
          {GUIDE_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === sectionId ? "page" : undefined}
              className={cn(
                "block w-full px-2 py-1.5 text-left text-xs",
                s.id === sectionId
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
              onClick={() => setSectionId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        {/* key remounts the scroll area so a new section starts at the top. */}
        <ScrollArea key={sectionId} className="min-h-0 flex-1">
          <main className="mx-auto w-full max-w-2xl p-6">
            <Markdown>{active.body}</Markdown>
          </main>
        </ScrollArea>
      </div>
    </div>
  );
}
