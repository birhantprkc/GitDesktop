import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { detectTerminals } from "@/lib/git/api";
import type { AppSettings } from "@/lib/settings/api";
import { useSaveSettings } from "@/lib/settings/queries";

const DEFAULT = "__default__";
const CUSTOM = "__custom__";

export function TerminalSection({ settings }: { settings: AppSettings }) {
  const saveSettings = useSaveSettings();
  const detected = useQuery({
    queryKey: ["detected-terminals"],
    queryFn: detectTerminals,
    staleTime: 5 * 60 * 1000,
  });
  const [pathDraft, setPathDraft] = useState(settings.terminalPath ?? "");

  useEffect(() => {
    setPathDraft(settings.terminalPath ?? "");
  }, [settings.terminalPath]);

  const terminals = detected.data ?? [];
  const matched = terminals.find((t) => t.id === settings.terminal);
  const isCustom = settings.terminal === "custom";
  const selectValue =
    settings.terminal === ""
      ? DEFAULT
      : isCustom
        ? CUSTOM
        : (matched?.id ?? CUSTOM);

  // Base UI's Select.Value renders the raw value unless given value→label items
  const selectItems: Record<string, string> = {
    [DEFAULT]: "Default (Command Prompt)",
    [CUSTOM]: "Custom…",
    ...Object.fromEntries(terminals.map((t) => [t.id, t.name])),
  };

  function save(terminal: string, terminalPath: string) {
    saveSettings.mutate(
      { ...settings, terminal, terminalPath },
      {
        onSuccess: () =>
          toast.success(
            terminal ? "Terminal updated" : "Terminal set to default",
          ),
      },
    );
  }

  async function browse() {
    const picked = await openDialog({
      title: "Choose a terminal program",
      filters: [{ name: "Programs", extensions: ["exe", "cmd", "bat"] }],
    });
    if (picked) {
      setPathDraft(picked);
      save("custom", picked);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Terminal</h2>
        <p className="text-xs text-muted-foreground">
          Used by "Open in terminal" in the repository menu. Installed terminals
          are detected automatically.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Terminal</Label>
        <Select
          items={selectItems}
          value={selectValue}
          onValueChange={(value) => {
            if (value === DEFAULT) {
              save("", "");
            } else if (value === CUSTOM) {
              if (!isCustom) save("custom", settings.terminalPath);
            } else if (value) {
              const terminal = terminals.find((t) => t.id === value);
              if (terminal) save(terminal.id, terminal.path);
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Default (Command Prompt)</SelectItem>
            {terminals.map((terminal) => (
              <SelectItem key={terminal.id} value={terminal.id}>
                {terminal.name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>Custom…</SelectItem>
          </SelectContent>
        </Select>
        {detected.isPending && (
          <p className="text-xs text-muted-foreground">Detecting terminals…</p>
        )}
        {matched && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {matched.path}
          </p>
        )}
      </div>
      {(isCustom || selectValue === CUSTOM) && (
        <div className="space-y-2">
          <Label htmlFor="custom-terminal">Program path</Label>
          <div className="flex gap-2">
            <Input
              id="custom-terminal"
              className="flex-1 font-mono"
              placeholder="C:\\path\\to\\terminal.exe"
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={() => {
                const trimmed = pathDraft.trim();
                if (trimmed !== settings.terminalPath) {
                  save("custom", trimmed);
                }
              }}
            />
            <Button variant="outline" onClick={browse}>
              Browse
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Launched in a new window at the repository folder.
          </p>
        </div>
      )}
    </section>
  );
}
