import { ArrowSquareOutIcon, SparkleIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
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
  useGhScopes,
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
    topics: s.topics,
    defaultBranch: s.defaultBranch,
    hasIssues: s.hasIssues,
    hasProjects: s.hasProjects,
    hasWiki: s.hasWiki,
    hasDiscussions: s.hasDiscussions,
    allowSquashMerge: s.allowSquashMerge,
    allowMergeCommit: s.allowMergeCommit,
    allowRebaseMerge: s.allowRebaseMerge,
    allowUpdateBranch: s.allowUpdateBranch,
    deleteBranchOnMerge: s.deleteBranchOnMerge,
    allowAutoMerge: s.allowAutoMerge,
    webCommitSignoffRequired: s.webCommitSignoffRequired,
    isTemplate: s.isTemplate,
    allowForking: s.allowForking,
    squashMergeCommitTitle: s.squashMergeCommitTitle,
    squashMergeCommitMessage: s.squashMergeCommitMessage,
    mergeCommitTitle: s.mergeCommitTitle,
    mergeCommitMessage: s.mergeCommitMessage,
  };
}

/** Valid squash/merge title+message pairs (GitHub 422s an invalid combo). Each
 *  encodes its `title/message` enum pair; the UI offers them as one choice. */
const SQUASH_DEFAULTS = [
  {
    value: "COMMIT_OR_PR_TITLE/COMMIT_MESSAGES",
    label: "Default (commit messages)",
  },
  { value: "PR_TITLE/PR_BODY", label: "Pull request title and description" },
  { value: "PR_TITLE/BLANK", label: "Pull request title" },
] as const;
const MERGE_DEFAULTS = [
  { value: "MERGE_MESSAGE/PR_TITLE", label: "Default merge message" },
  { value: "PR_TITLE/PR_BODY", label: "Pull request title and description" },
  { value: "PR_TITLE/BLANK", label: "Pull request title" },
] as const;

/** Repo settings that have NO GitHub API — only manageable in the browser. */
const WEB_ONLY_SETTINGS = [
  "Display a Sponsor button",
  "Allow commenting on individual commits",
  "Include Git LFS objects in archives",
  "Limit branches and tags updated in a single push",
  "Auto-close issues with merged linked pull requests",
];

/** A muted readout of the gh token's OAuth scopes — context for what governance
 *  actions are available. Hidden for fine-grained/App tokens (no classic scopes). */
function GhScopesNote() {
  const scopes = useGhScopes();
  if (!scopes.data?.classic || scopes.data.scopes.length === 0) return null;
  return (
    <p className="text-[11px] text-muted-foreground">
      Your GitHub sign-in grants:{" "}
      <span className="font-mono">{scopes.data.scopes.join(", ")}</span>
    </p>
  );
}

/** A single dropdown for a default commit title+message pair. Keeps the current
 *  (possibly non-standard) value selectable so the picker never shows blank. */
function CommitMessageSelect({
  id,
  label,
  disabled,
  options,
  title,
  message,
  onChange,
}: {
  id: string;
  label: string;
  disabled: boolean;
  options: readonly { value: string; label: string }[];
  title: string;
  message: string;
  onChange: (title: string, message: string) => void;
}) {
  const value = `${title}/${message}`;
  const opts = options.some((o) => o.value === value)
    ? options
    : [{ value, label: `${title} / ${message}` }, ...options];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={disabled ? "text-muted-foreground" : ""}>
        {label}
      </Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(v) => {
          if (!v) return;
          const [t, m] = v.split("/");
          onChange(t, m);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-w-[min(22rem,80vw)]">
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <span className="block truncate">{o.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Space/comma-separated text → GitHub's lowercase, deduped, capped topic list. */
function parseTopics(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((t) => t.toLowerCase().replace(/[^a-z0-9-]/g, ""))
        .filter(Boolean),
    ),
  ].slice(0, 20);
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
  // Topics edit as free text (space-separated) but persist as a parsed array.
  const [topicsText, setTopicsText] = useState(settings.topics.join(" "));

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

  // Keep the raw text (so trailing spaces survive typing) and the parsed array
  // (used for the dirty check and save) in sync.
  function applyTopics(text: string) {
    setTopicsText(text);
    set("topics", parseTopics(text));
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
                    onResult: ({ description, topics }) => {
                      if (description) set("description", description);
                      if (topics.length) applyTopics(topics.join(" "));
                    },
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

      <div className="space-y-1.5">
        <Label htmlFor="repo-topics">
          Topics{" "}
          <span className="font-normal text-muted-foreground">
            (separate with spaces)
          </span>
        </Label>
        <Input
          id="repo-topics"
          value={topicsText}
          onChange={(e) => applyTopics(e.target.value)}
          placeholder="react typescript cli"
          autoComplete="off"
          spellCheck={false}
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
            <SelectTrigger id="repo-default-branch" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-w-[min(20rem,80vw)]">
              {branchOptions.map((b) => (
                <SelectItem key={b} value={b}>
                  <span
                    className="block truncate"
                    // Tooltip only when the branch name is actually clipped.
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.title = el.scrollWidth > el.clientWidth ? b : "";
                    }}
                  >
                    {b}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Features</Label>
        <div className="grid grid-cols-2 gap-2">
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
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={form.hasDiscussions}
              onCheckedChange={(c) => set("hasDiscussions", c === true)}
            />
            Discussions
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
        <div className="grid grid-cols-2 gap-4 pt-1">
          <CommitMessageSelect
            id="squash-default"
            label="Squash merge message"
            disabled={!form.allowSquashMerge}
            options={SQUASH_DEFAULTS}
            title={form.squashMergeCommitTitle}
            message={form.squashMergeCommitMessage}
            onChange={(t, m) =>
              setForm((f) => ({
                ...f,
                squashMergeCommitTitle: t,
                squashMergeCommitMessage: m,
              }))
            }
          />
          <CommitMessageSelect
            id="merge-default"
            label="Merge commit message"
            disabled={!form.allowMergeCommit}
            options={MERGE_DEFAULTS}
            title={form.mergeCommitTitle}
            message={form.mergeCommitMessage}
            onChange={(t, m) =>
              setForm((f) => ({
                ...f,
                mergeCommitTitle: t,
                mergeCommitMessage: m,
              }))
            }
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-xs">
          <Switch
            checked={form.allowUpdateBranch}
            onCheckedChange={(c) => set("allowUpdateBranch", c)}
          />
          Always suggest updating pull request branches
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.allowAutoMerge}
            onCheckedChange={(c) => set("allowAutoMerge", c)}
          />
          Allow auto-merge
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.deleteBranchOnMerge}
            onCheckedChange={(c) => set("deleteBranchOnMerge", c)}
          />
          Automatically delete head branches after merge
        </label>
      </div>

      <div className="space-y-2">
        <Label>Commits</Label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.webCommitSignoffRequired}
            onCheckedChange={(c) => set("webCommitSignoffRequired", c)}
          />
          Require contributors to sign off on web-based commits
        </label>
      </div>

      <div className="space-y-2">
        <Label>Repository</Label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.isTemplate}
            onCheckedChange={(c) => set("isTemplate", c)}
          />
          Template repository
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch
            checked={form.allowForking}
            onCheckedChange={(c) => set("allowForking", c)}
          />
          Allow forking
        </label>
      </div>

      {settings.htmlUrl && (
        <div className="space-y-2">
          <Label>Only on GitHub</Label>
          <p className="text-xs text-muted-foreground">
            GitHub doesn't expose these to apps — manage them in your browser.
          </p>
          <ul className="space-y-1">
            {WEB_ONLY_SETTINGS.map((label) => (
              <li key={label}>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
                  onClick={() => openUrl(`${settings.htmlUrl}/settings`)}
                >
                  {label}
                  <ArrowSquareOutIcon className="size-3 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <GhScopesNote />

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
