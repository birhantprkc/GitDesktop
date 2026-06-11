import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SectionProps } from "./SettingsScreen";

export function GitSection({ draft, update }: SectionProps) {
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
          autoComplete="off"
          value={draft.defaultBranch}
          onChange={(e) => update({ defaultBranch: e.target.value })}
        />
      </div>
    </section>
  );
}
