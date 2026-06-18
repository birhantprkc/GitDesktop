import { SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  useBranches,
  useRepoSettings,
  useUpdateRepoSettings,
} from "@/lib/git/queries";
import type { Branch, RepoSettings, RepoSettingsInput } from "@/lib/git/types";
import { useAiConfigured, useAiEnabled } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useGenerateRepoDescription } from "./useGenerateRepoDescription";

export function GeneralSettingsSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const settings = useRepoSettings(repoPath, open);
  const branches = useBranches(repoPath);

  if (settings.isLoading) {
    return (
      <div className="min-w-0 space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <p className="font-medium text-destructive">Couldn't load settings.</p>
        <p className="mt-1 text-muted-foreground">
          {settings.error instanceof Error ? settings.error.message : null}
        </p>
      </div>
    );
  }

  return (
    <GeneralForm
      repoPath={repoPath}
      settings={settings.data}
      branches={branches.data ?? []}
    />
  );
}

function toInput(s: RepoSettings): RepoSettingsInput {
  return {
    description: s.description ?? "",
    homepage: s.homepage ?? "",
    defaultBranch: s.defaultBranch,
    hasIssues: s.hasIssues,
    hasProjects: s.hasProjects,
    hasWiki: s.hasWiki,
    allowSquashMerge: s.allowSquashMerge,
    allowMergeCommit: s.allowMergeCommit,
    allowRebaseMerge: s.allowRebaseMerge,
    deleteBranchOnMerge: s.deleteBranchOnMerge,
    allowAutoMerge: s.allowAutoMerge,
  };
}

function GeneralForm({
  repoPath,
  settings,
  branches,
}: {
  repoPath: string;
  settings: RepoSettings;
  branches: Branch[];
}) {
  const update = useUpdateRepoSettings(repoPath);
  const base = toInput(settings);
  const [form, setForm] = useState<RepoSettingsInput>(base);

  const aiEnabled = useAiEnabled();
  const aiConfigured = useAiConfigured();
  const openSettings = useUiStore((s) => s.openSettings);
  const repoName =
    useUiStore((s) => s.repoName) ?? repoPath.split(/[/\\]/).pop() ?? repoPath;
  const descGen = useGenerateRepoDescription(repoPath);

  function set<K extends keyof RepoSettingsInput>(
    key: K,
    value: RepoSettingsInput[K],
  ) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const mergeValid =
    form.allowSquashMerge || form.allowMergeCommit || form.allowRebaseMerge;
  const dirty = JSON.stringify(form) !== JSON.stringify(base);

  // Keep the current default selectable even if that branch isn't local.
  const branchNames = branches.map((b) => b.name);
  const branchOptions = branchNames.includes(form.defaultBranch)
    ? branchNames
    : [form.defaultBranch, ...branchNames];

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="repo-description">Description</Label>
          {aiEnabled &&
            (!aiConfigured ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => openSettings("ai")}
              >
                <SparkleIcon data-icon="inline-start" />
                Set up AI
              </Button>
            ) : descGen.generating ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={descGen.cancel}
              >
                <Spinner data-icon="inline-start" />
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() =>
                  descGen.generate({
                    repoName,
                    onResult: (text) => set("description", text),
                  })
                }
              >
                <SparkleIcon data-icon="inline-start" />
                Generate
              </Button>
            ))}
        </div>
        <Input
          id="repo-description"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Short description of this repository"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="repo-homepage">Homepage URL</Label>
          <Input
            id="repo-homepage"
            value={form.homepage}
            onChange={(e) => set("homepage", e.target.value)}
            placeholder="https://…"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repo-default-branch">Default branch</Label>
          <Select
            value={form.defaultBranch}
            onValueChange={(v) => {
              if (v) set("defaultBranch", v);
            }}
          >
            <SelectTrigger id="repo-default-branch">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {branchOptions.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Features</Label>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasIssues}
              onCheckedChange={(c) => set("hasIssues", c === true)}
            />
            Issues
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasProjects}
              onCheckedChange={(c) => set("hasProjects", c === true)}
            />
            Projects
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasWiki}
              onCheckedChange={(c) => set("hasWiki", c === true)}
            />
            Wiki
          </label>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Pull request merges</Label>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowMergeCommit}
              onCheckedChange={(c) => set("allowMergeCommit", c === true)}
            />
            Merge commits
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowSquashMerge}
              onCheckedChange={(c) => set("allowSquashMerge", c === true)}
            />
            Squash merging
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.allowRebaseMerge}
              onCheckedChange={(c) => set("allowRebaseMerge", c === true)}
            />
            Rebase merging
          </label>
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Switch
            checked={form.deleteBranchOnMerge}
            onCheckedChange={(c) => set("deleteBranchOnMerge", c)}
          />
          Automatically delete head branches after merge
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.allowAutoMerge}
            onCheckedChange={(c) => set("allowAutoMerge", c)}
          />
          Allow auto-merge
        </label>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        {!mergeValid && (
          <span className="mr-auto text-xs text-destructive">
            Enable at least one merge method.
          </span>
        )}
        <Button
          disabled={!dirty || !mergeValid || update.isPending}
          onClick={() =>
            update.mutate(form, {
              onSuccess: () => toast.success("Repository settings saved"),
              onError: toastError,
            })
          }
        >
          {update.isPending && <Spinner data-icon="inline-start" />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
