import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AppSettings } from "@/lib/settings/api";
import { useSaveSettings } from "@/lib/settings/queries";

export function GitSection({ settings }: { settings: AppSettings }) {
  const saveSettings = useSaveSettings();
  const [draft, setDraft] = useState(settings.defaultBranch ?? "main");

  useEffect(() => {
    setDraft(settings.defaultBranch ?? "main");
  }, [settings.defaultBranch]);

  function save() {
    const branch = draft.trim() || "main";
    setDraft(branch);
    if (branch === settings.defaultBranch) return;
    if (branch.startsWith("-") || branch.includes(" ")) {
      toast.error(`"${branch}" is not a valid branch name`);
      setDraft(settings.defaultBranch);
      return;
    }
    saveSettings.mutate(
      { ...settings, defaultBranch: branch },
      { onSuccess: () => toast.success(`Default branch set to ${branch}`) },
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">Git</h2>
        <p className="text-xs text-muted-foreground">
          Defaults applied when creating new repositories.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="default-branch">
          Default branch for new repositories
        </Label>
        <Input
          id="default-branch"
          className="max-w-60 font-mono"
          placeholder="main"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
      </div>
    </section>
  );
}
