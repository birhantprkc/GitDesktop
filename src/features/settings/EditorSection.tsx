import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
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
import type { SectionProps } from "./SettingsScreen";

const CUSTOM = "__custom__";
const NONE = "__none__";

export function EditorSection({ draft, update }: SectionProps) {
  const detected = useQuery({
    queryKey: ["detected-editors"],
    queryFn: detectEditors,
    staleTime: 5 * 60 * 1000,
  });
  // "Custom…" picked while a detected editor is still set: reveal the path
  // input without changing the draft yet.
  const [forceCustom, setForceCustom] = useState(false);

  const editors = detected.data ?? [];
  const matched = editors.find((e) => e.path === draft.externalEditor);
  const selectValue = forceCustom
    ? CUSTOM
    : !draft.externalEditor
      ? NONE
      : (matched?.path ?? CUSTOM);
  const showCustom = selectValue === CUSTOM;

  // Base UI's Select.Value renders the raw value unless given value→label items
  const selectItems: Record<string, string> = {
    [NONE]: "None",
    [CUSTOM]: "Custom…",
    ...Object.fromEntries(editors.map((e) => [e.path, e.name])),
  };

  async function choose() {
    const picked = await openDialog({
      title: "Choose a program",
      filters: [{ name: "Programs", extensions: ["exe", "cmd", "bat"] }],
    });
    if (picked) {
      update({
        externalEditor: picked,
        externalEditorName: programLabel(picked),
      });
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
        <Label htmlFor="editor-select">Editor</Label>
        <Select
          items={selectItems}
          value={selectValue}
          onValueChange={(value) => {
            if (value === NONE) {
              setForceCustom(false);
              update({ externalEditor: "", externalEditorName: "" });
            } else if (value === CUSTOM) {
              setForceCustom(true);
            } else if (value) {
              const editor = editors.find((e) => e.path === value);
              if (editor) {
                setForceCustom(false);
                update({
                  externalEditor: editor.path,
                  externalEditorName: editor.name,
                });
              }
            }
          }}
        >
          <SelectTrigger id="editor-select" className="w-full">
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
        {!showCustom && matched && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            {matched.path}
          </p>
        )}
      </div>
      {showCustom && (
        <div className="space-y-2">
          <Label htmlFor="external-editor">Program path</Label>
          <div className="flex gap-2">
            <Input
              id="external-editor"
              className="flex-1 font-mono"
              placeholder="C:\\path\\to\\editor.exe"
              value={draft.externalEditor}
              onChange={(e) =>
                update({
                  externalEditor: e.target.value,
                  externalEditorName: programLabel(e.target.value),
                })
              }
            />
            <Button variant="outline" onClick={choose}>
              Choose…
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
