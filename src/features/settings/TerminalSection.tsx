import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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
import type { SectionProps } from "./SettingsScreen";

const DEFAULT = "__default__";
const CUSTOM = "__custom__";

export function TerminalSection({ draft, update }: SectionProps) {
  const detected = useQuery({
    queryKey: ["detected-terminals"],
    queryFn: detectTerminals,
    staleTime: 5 * 60 * 1000,
  });

  const terminals = detected.data ?? [];
  const matched = terminals.find((t) => t.id === draft.terminal);
  const isCustom = draft.terminal === "custom";
  const selectValue =
    draft.terminal === ""
      ? DEFAULT
      : isCustom
        ? CUSTOM
        : (matched?.id ?? CUSTOM);
  const showCustom = selectValue === CUSTOM;

  // Base UI's Select.Value renders the raw value unless given value→label items
  const selectItems: Record<string, string> = {
    [DEFAULT]: "Default (Command Prompt)",
    [CUSTOM]: "Custom…",
    ...Object.fromEntries(terminals.map((t) => [t.id, t.name])),
  };

  async function choose() {
    const picked = await openDialog({
      title: "Choose a terminal program",
      filters: [{ name: "Programs", extensions: ["exe", "cmd", "bat"] }],
    });
    if (picked) update({ terminal: "custom", terminalPath: picked });
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
        <Label htmlFor="terminal-select">Application</Label>
        <Select
          items={selectItems}
          value={selectValue}
          onValueChange={(value) => {
            if (value === DEFAULT) {
              update({ terminal: "", terminalPath: "" });
            } else if (value === CUSTOM) {
              if (!isCustom) update({ terminal: "custom" });
            } else if (value) {
              const terminal = terminals.find((t) => t.id === value);
              if (terminal) {
                update({ terminal: terminal.id, terminalPath: terminal.path });
              }
            }
          }}
        >
          <SelectTrigger id="terminal-select" className="w-full">
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
        {!showCustom && matched && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {matched.path}
          </p>
        )}
      </div>
      {showCustom && (
        <div className="space-y-2">
          <Label htmlFor="custom-terminal">Program path</Label>
          <div className="flex gap-2">
            <Input
              id="custom-terminal"
              className="flex-1 font-mono"
              placeholder="C:\\path\\to\\terminal.exe"
              value={draft.terminalPath}
              onChange={(e) =>
                update({ terminal: "custom", terminalPath: e.target.value })
              }
            />
            <Button variant="outline" onClick={choose}>
              Choose…
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
