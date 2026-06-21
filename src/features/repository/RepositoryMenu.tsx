import {
  ArrowSquareOutIcon,
  ChartBarIcon,
  CodeIcon,
  CopyIcon,
  CubeIcon,
  DotsThreeVerticalIcon,
  FilesIcon,
  FolderOpenIcon,
  GearSixIcon,
  GitForkIcon,
  LightningIcon,
  LinkIcon,
  PencilSimpleIcon,
  ShieldCheckIcon,
  StarIcon,
  TagSimpleIcon,
  TerminalIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { RepoAutomationsDialog } from "@/features/automations/RepoAutomationsDialog";
import { BranchRulesDialog } from "@/features/branch-rules/BranchRulesDialog";
import { HooksDialog } from "@/features/hooks/HooksDialog";
import { RepoSettingsDialog } from "@/features/repo-settings/RepoSettingsDialog";
import { copyText } from "@/lib/clipboard";
import {
  ghRepoUrl,
  openInTerminal,
  openWithDefault,
  openWithProgram,
} from "@/lib/git/api";
import {
  useForkRepo,
  useGhStatus,
  useRepoAdmin,
  useRepoStarStatus,
  useSetRepoStar,
  useSubmodules,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import type { RecentRepo } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { RemoteUrlDialog } from "./RemoteUrlDialog";
import { RemoveRepoDialog, RepoAliasDialog } from "./RepoDialogs";
import { RepositoryFilesDialog } from "./RepositoryFilesDialog";
import { SubmodulesDialog } from "./SubmodulesDialog";

export function RepositoryMenu({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const settings = useSettings();
  const repoName = useUiStore((s) => s.repoName);
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const fork = useForkRepo(repoPath);
  const [automationsOpen, setAutomationsOpen] = useState(false);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [branchRulesOpen, setBranchRulesOpen] = useState(false);
  const [hooksOpen, setHooksOpen] = useState(false);
  const [submodulesOpen, setSubmodulesOpen] = useState(false);
  // Only offer the Submodules menu item when the repo actually has submodules.
  const submodules = useSubmodules(repoPath);
  const hasSubmodules = (submodules.data?.length ?? 0) > 0;
  const [forkOpen, setForkOpen] = useState(false);
  const [forkIntent, setForkIntent] = useState<"contribute" | "own">(
    "contribute",
  );
  const [remoteUrlOpen, setRemoteUrlOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [aliasTarget, setAliasTarget] = useState<RecentRepo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RecentRepo | null>(null);

  // This repo's recents entry (carries the alias); synthesized if missing.
  const repoEntry: RecentRepo = settings.data?.recentRepos.find(
    (r) => r.path === repoPath,
  ) ?? {
    path: repoPath,
    name: repoName ?? repoPath,
    lastOpenedAt: "",
  };

  const canGh = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const starStatus = useRepoStarStatus(repoPath, canGh);
  const setStar = useSetRepoStar(repoPath);
  const starred = starStatus.data ?? false;
  // Repo settings (webhooks) are admin-only; the menu item hides for everyone else.
  const admin = useRepoAdmin(repoPath, canGh);
  const editor = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";

  const onError = (e: unknown) => toastError(e);

  async function openWeb(suffix = "") {
    try {
      const url = await ghRepoUrl(repoPath);
      await openUrl(`${url}${suffix}`);
    } catch (e) {
      onError(e);
    }
  }

  // Every menu entry doubles as a hotkey/palette action with the same gates.
  useHotkeyAction("view-on-github", () => openWeb(), canGh);
  // create-issue is the in-app dialog (registered in RepositoryView + IssuesPanel);
  // the "Create issue on GitHub" menu item below still opens the web page directly.
  useHotkeyAction("fork-repository", () => setForkOpen(true), canGh);
  useHotkeyAction("open-in-terminal", () =>
    openInTerminal(
      repoPath,
      settings.data?.terminal,
      settings.data?.terminalPath,
    ).catch(onError),
  );
  useHotkeyAction("show-in-explorer", () =>
    openWithDefault(repoPath).catch(onError),
  );
  useHotkeyAction(
    "open-in-editor",
    () => openWithProgram(editor, repoPath).catch(onError),
    Boolean(editor),
  );
  useHotkeyAction("repository-statistics", () => setRepoTab("insights"));
  useHotkeyAction("manage-files", () => setFilesOpen(true));
  useHotkeyAction("automations", () => setAutomationsOpen(true));
  useHotkeyAction(
    "repository-settings",
    () => setRepoSettingsOpen(true),
    canGh && Boolean(admin.data),
  );
  useHotkeyAction("branch-rules", () => setBranchRulesOpen(true));
  useHotkeyAction("git-hooks", () => setHooksOpen(true));
  useHotkeyAction("submodules", () => setSubmodulesOpen(true), hasSubmodules);
  useHotkeyAction(
    "star-repository",
    () =>
      setStar.mutate(!starred, {
        onSuccess: () =>
          toast.success(
            starred
              ? "Star removed"
              : `Starred ${gh.data?.repo ?? "repository"}`,
          ),
        onError,
      }),
    canGh && !setStar.isPending,
  );
  useHotkeyAction("change-remote-url", () => setRemoteUrlOpen(true));
  useHotkeyAction("repo-alias", () => setAliasTarget(repoEntry));
  useHotkeyAction("copy-repo-path", () =>
    copyText(repoPath, "Repository path copied"),
  );
  useHotkeyAction("remove-repository", () => setRemoveTarget(repoEntry));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Repository actions"
          />
        }
      >
        <DotsThreeVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        {canGh && (
          <>
            <DropdownMenuItem onClick={() => openWeb()}>
              <ArrowSquareOutIcon />
              View on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={setStar.isPending}
              onClick={() =>
                setStar.mutate(!starred, {
                  onSuccess: () =>
                    toast.success(
                      starred
                        ? "Star removed"
                        : `Starred ${gh.data?.repo ?? "repository"}`,
                    ),
                  onError,
                })
              }
            >
              <StarIcon weight={starred ? "fill" : "regular"} />
              {starred ? "Unstar repository" : "Star repository"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWeb("/issues/new")}>
              <WarningCircleIcon />
              Create issue on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setForkOpen(true)}>
              <GitForkIcon />
              Fork repository…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() =>
            openInTerminal(
              repoPath,
              settings.data?.terminal,
              settings.data?.terminalPath,
            ).catch(onError)
          }
        >
          <TerminalIcon />
          Open in terminal
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openWithDefault(repoPath).catch(onError)}
        >
          <FolderOpenIcon />
          Show in Explorer
        </DropdownMenuItem>
        {editor && (
          <DropdownMenuItem
            onClick={() => openWithProgram(editor, repoPath).catch(onError)}
          >
            <PencilSimpleIcon />
            Open in {editorName}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setRepoTab("insights")}>
          <ChartBarIcon />
          Insights…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setFilesOpen(true)}>
          <FilesIcon />
          Manage files…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAutomationsOpen(true)}>
          <LightningIcon />
          Automations…
        </DropdownMenuItem>
        {canGh && admin.data && (
          <DropdownMenuItem onClick={() => setRepoSettingsOpen(true)}>
            <GearSixIcon />
            Repository settings…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setBranchRulesOpen(true)}>
          <ShieldCheckIcon />
          Branch rules…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setHooksOpen(true)}>
          <CodeIcon />
          Git hooks…
        </DropdownMenuItem>
        {hasSubmodules && (
          <DropdownMenuItem onClick={() => setSubmodulesOpen(true)}>
            <CubeIcon />
            Submodules…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setRemoteUrlOpen(true)}>
          <LinkIcon />
          Change remote URL…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAliasTarget(repoEntry)}>
          <TagSimpleIcon />
          {repoEntry.alias ? "Change alias…" : "Create alias…"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => copyText(repoPath, "Repository path copied")}
        >
          <CopyIcon />
          Copy repository path
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={() => setRemoveTarget(repoEntry)}
        >
          <TrashIcon />
          Remove…
        </DropdownMenuItem>
      </DropdownMenuContent>
      <RepoAutomationsDialog
        repoPath={repoPath}
        open={automationsOpen}
        onOpenChange={setAutomationsOpen}
      />
      <RepoSettingsDialog
        repoPath={repoPath}
        open={repoSettingsOpen}
        onOpenChange={setRepoSettingsOpen}
      />
      <BranchRulesDialog
        repoPath={repoPath}
        open={branchRulesOpen}
        onOpenChange={setBranchRulesOpen}
      />
      <HooksDialog
        repoPath={repoPath}
        open={hooksOpen}
        onOpenChange={setHooksOpen}
      />
      <SubmodulesDialog
        repoPath={repoPath}
        open={submodulesOpen}
        onOpenChange={setSubmodulesOpen}
      />
      <RemoteUrlDialog
        repoPath={repoPath}
        open={remoteUrlOpen}
        onOpenChange={setRemoteUrlOpen}
      />
      <RepositoryFilesDialog
        repoPath={repoPath}
        open={filesOpen}
        onOpenChange={setFilesOpen}
      />
      <RepoAliasDialog
        key={
          aliasTarget
            ? `${aliasTarget.path}:${aliasTarget.alias ?? ""}`
            : "none"
        }
        repo={aliasTarget}
        onClose={() => setAliasTarget(null)}
      />
      <RemoveRepoDialog
        repo={removeTarget}
        onClose={() => setRemoveTarget(null)}
      />
      <Dialog open={forkOpen} onOpenChange={setForkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Fork this repository?</DialogTitle>
            <DialogDescription>
              Creates a fork of {gh.data?.repo ?? "this repository"} under your
              GitHub account and rewires the remotes: your fork becomes{" "}
              <span className="font-mono">origin</span> and the original
              repository becomes <span className="font-mono">upstream</span>.
              Pushes go to your fork either way.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs font-medium">I'll be using this fork…</p>
            <RadioGroup
              value={forkIntent}
              onValueChange={(v) => setForkIntent(v as "contribute" | "own")}
            >
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <Radio value="contribute" className="mt-0.5" />
                <span>
                  <span className="font-medium">
                    To contribute to the parent repository
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Pull requests, issues, and "View on GitHub" keep targeting{" "}
                    {gh.data?.repo ?? "the original repository"}.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <Radio value="own" className="mt-0.5" />
                <span>
                  <span className="font-medium">For my own purposes</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    Pull requests, issues, and "View on GitHub" target your fork
                    instead.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setForkOpen(false)}
              disabled={fork.isPending}
            >
              Cancel
            </Button>
            <Button
              disabled={fork.isPending}
              onClick={() =>
                fork.mutate(forkIntent === "contribute", {
                  onSuccess: (url) => {
                    setForkOpen(false);
                    toast.success(
                      url
                        ? "Forked — your fork is now origin"
                        : "Fork already existed — remotes updated",
                      { description: url || undefined },
                    );
                  },
                  onError,
                })
              }
            >
              {fork.isPending && <Spinner data-icon="inline-start" />}
              Fork repository
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}
