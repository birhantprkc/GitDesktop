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
import { detectEditors } from "@/lib/git/api";
import type { AppSettings } from "@/lib/settings/api";
import { useSaveSettings } from "@/lib/settings/queries";

const CUSTOM = "__custom__";
const NONE = "__none__";

export function EditorSection({ settings }: { settings: AppSettings }) {
  const saveSettings = useSaveSettings();
  const detected = useQuery({
    queryKey: ["detected-editors"],
    queryFn: detectEditors,
    staleTime: 5 * 60 * 1000,
  });
  const [pathDraft, setPathDraft] = useState(settings.externalEditor);

  useEffect(() => {
    setPathDraft(settings.externalEditor);
  }, [settings.externalEditor]);

  const editors = detected.data ?? [];
  const matched = editors.find((e) => e.path === settings.externalEditor);
  const selectValue = !settings.externalEditor
    ? NONE
    : (matched?.path ?? CUSTOM);
  const isCustom = Boolean(settings.externalEditor) && !matched;

  // Base UI's Select.Value renders the raw value unless given value→label items
  const selectItems: Record<string, string> = {
    [NONE]: "None",
    [CUSTOM]: "Custom…",
    ...Object.fromEntries(editors.map((e) => [e.path, e.name])),
  };

  function save(path: string, name: string) {
    saveSettings.mutate(
      { ...settings, externalEditor: path, externalEditorName: name },
      {
        onSuccess: () =>
          toast.success(path ? `Editor set to ${name}` : "Editor cleared"),
      },
    );
  }

  async function browse() {
    const picked = await openDialog({
      title: "Choose a program",
      filters: [{ name: "Programs", extensions: ["exe", "cmd", "bat"] }],
    });
    if (picked) {
      setPathDraft(picked);
      save(picked, programLabel(picked));
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">External editor</h2>
        <p className="text-xs text-muted-foreground">
          Adds an "Open in …" entry to the file context menu. Installed editors
          are detected automatically.
        </p>
      </div>
      <div className="space-y-2">
        <Label>Editor</Label>
        <Select
          items={selectItems}
          value={selectValue}
          onValueChange={(value) => {
            if (value === NONE) {
              save("", "");
            } else if (value === CUSTOM) {
              // keep current path; just reveal the custom input
              if (!isCustom) save(settings.externalEditor, "Custom");
            } else if (value) {
              const editor = editors.find((e) => e.path === value);
              if (editor) save(editor.path, editor.name);
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {editors.map((editor) => (
              <SelectItem key={editor.path} value={editor.path}>
                {editor.name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM}>Custom…</SelectItem>
          </SelectContent>
        </Select>
        {detected.isPending && (
          <p className="text-xs text-muted-foreground">Detecting editors…</p>
        )}
        {matched && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {matched.path}
          </p>
        )}
      </div>
      {(isCustom || selectValue === CUSTOM) && (
        <div className="space-y-2">
          <Label htmlFor="external-editor">Program path</Label>
          <div className="flex gap-2">
            <Input
              id="external-editor"
              className="flex-1 font-mono"
              placeholder="C:\\path\\to\\editor.exe"
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onBlur={() => {
                const trimmed = pathDraft.trim();
                if (trimmed !== settings.externalEditor) {
                  save(trimmed, programLabel(trimmed));
                }
              }}
            />
            <Button variant="outline" onClick={browse}>
              Browse
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** "C:\\apps\\Code.exe" -> "Code" for labels. */
function programLabel(program: string): string {
  const base = program.replaceAll("\\", "/").split("/").pop() ?? program;
  return base.replace(/\.(exe|cmd|bat)$/i, "") || "Custom";
}
