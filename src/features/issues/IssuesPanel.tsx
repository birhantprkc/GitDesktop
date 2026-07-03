import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConversationFilterPopover } from "@/features/conversations/ConversationFilterPopover";
import { ConversationListPanel } from "@/features/conversations/ConversationListPanel";
import { useLocalRemoteFilter } from "@/features/conversations/useLocalRemoteFilter";
import { forgeRepoUrl, type IssueStateFilter } from "@/lib/git/api";
import {
  forgeFeatureReady,
  useForgeStatus,
  useHoverPrefetch,
  useIssueList,
  usePrefetchIssue,
} from "@/lib/git/queries";
import { providerLabel } from "@/lib/git/types";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { useLocalIssues } from "@/lib/issues/queries";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { CreateLocalIssueDialog } from "./CreateLocalIssueDialog";

/** Bitbucket has retired its native issue tracker (deleted platform-wide
 *  2026-08-20), so a connected Bitbucket repo has no issues to list — issues
 *  moved to Jira. Explain that instead of prompting a connection. */
function BitbucketIssuesSunset({ repoPath }: { repoPath: string }) {
  return (
    <div className="space-y-2.5 px-3 py-4 text-xs text-muted-foreground">
      <p>
        Bitbucket has retired its native issue tracker — issues for Bitbucket
        repositories live in Jira.
      </p>
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        onClick={() => forgeRepoUrl(repoPath).then(openUrl).catch(toastError)}
      >
        <ArrowSquareOutIcon data-icon="inline-start" />
        View repository on Bitbucket
      </Button>
    </div>
  );
}

export function IssuesPanel({ repoPath }: { repoPath: string }) {
  const gh = useForgeStatus(repoPath);
  const provider = gh.data?.provider;
  const isGitLab = provider === "gitlab";
  const isBitbucket = provider === "bitbucket";
  const remoteLabel = providerLabel(provider);
  // Issue *reads* are provider-neutral (the panel-level `issues` flag); issue
  // *creation* follows its own per-action write flag — ready GitHub AND GitLab
  // repos both offer the create dialog (which hides GitHub-only fields per
  // provider), while a not-ready repo gets a disabled item with the reason.
  const ghReady = forgeFeatureReady(gh.data, "issues");
  const canCreateGh = forgeFeatureReady(gh.data, "issueCreate");
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>("open");
  const issueList = useIssueList(repoPath, ghReady, stateFilter);
  const selectedIssue = useUiStore((s) => s.selectedIssue);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const prefetchIssue = usePrefetchIssue(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const filterRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createLocalOpen, setCreateLocalOpen] = useState(false);
  const localIssues = useLocalIssues(repoPath);
  const pendingIssueDraft = useUiStore((s) => s.pendingIssueDraft);
  const setPendingIssueDraft = useUiStore((s) => s.setPendingIssueDraft);
  const pendingCreate = useUiStore((s) => s.pendingCreate);
  const clearPendingCreate = useUiStore((s) => s.clearPendingCreate);
  const [issueDraft, setIssueDraft] = useState<
    { title: string; body: string; labels?: string[] } | undefined
  >();

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());
  useHotkeyAction("create-issue", () => setCreateOpen(true), canCreateGh);

  // "Reference in new issue" / "Duplicate issue" seeds + opens the create dialog.
  // Re-check the gate (like the PR panel): the seeder's own gate can lag this
  // panel's — never open a create dialog that can't submit.
  useEffect(() => {
    if (pendingIssueDraft) {
      if (canCreateGh) {
        setIssueDraft(pendingIssueDraft);
        setCreateOpen(true);
      }
      setPendingIssueDraft(null);
    }
  }, [pendingIssueDraft, setPendingIssueDraft, canCreateGh]);

  // Opened from the command palette / New menu via requestCreate (works from any
  // tab — RepositoryView switches here first, then this fires).
  useEffect(() => {
    if (pendingCreate === "issue") {
      if (canCreateGh) setCreateOpen(true);
      clearPendingCreate();
    } else if (pendingCreate === "local-issue") {
      setCreateLocalOpen(true);
      clearPendingCreate();
    }
  }, [pendingCreate, clearPendingCreate, canCreateGh]);

  const {
    filterText,
    setFilterText,
    authorFilter,
    labelFilter,
    toggle,
    showArchived,
    setShowArchived,
    authors,
    labels,
    activeFilterCount,
    stateLocal,
    stateRemote: issues,
    visibleLocal,
    archivedLocalCount,
    visibleRemote: visible,
    authorCount,
    labelCount,
  } = useLocalRemoteFilter({
    locals: localIssues.data ?? [],
    remotes: issueList.data ?? [],
    stateFilter,
  });

  // Arrow keys walk the visible rows, local section first like the list.
  const navTargets = [
    ...visibleLocal.map((i) => ({ kind: "local" as const, id: i.id })),
    ...visible.map((i) => ({ kind: "remote" as const, id: String(i.number) })),
  ];

  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.findIndex(
      (t) => t.kind === selectedIssue?.kind && t.id === selectedIssue.id,
    ),
    onActivate: (target) => selectIssue(target),
    rowKey: (target) => `${target.kind}:${target.id}`,
  });

  const RowIcon = stateFilter === "open" ? CircleDashedIcon : CheckCircleIcon;

  return (
    <ConversationListPanel
      repoPath={repoPath}
      feature="issues"
      remoteLabel={remoteLabel}
      stateFilter={stateFilter}
      onStateFilter={setStateFilter}
      newMenu={{
        ghLabel: isBitbucket
          ? "Issue on Bitbucket…"
          : isGitLab
            ? "Issue on GitLab…"
            : "Issue on GitHub…",
        ghDisabled: !canCreateGh,
        ghReason: canCreateGh
          ? undefined
          : isBitbucket
            ? "Bitbucket has retired its native issue tracker — issues for Bitbucket repositories live in Jira."
            : isGitLab
              ? gh.data?.installed
                ? "Sign in to GitLab (glab auth login) to open issues here."
                : "Install the GitLab CLI (glab) to open issues here."
              : "Connect this repository to GitHub to open an issue.",
        onGh: () => setCreateOpen(true),
        localLabel: "Local issue…",
        onLocal: () => setCreateLocalOpen(true),
      }}
      filterSlot={
        <ConversationFilterPopover
          authors={authors}
          labels={labels}
          authorFilter={authorFilter}
          labelFilter={labelFilter}
          toggle={toggle}
          activeFilterCount={activeFilterCount}
          authorCount={authorCount}
          labelCount={labelCount}
        />
      }
      filterRef={filterRef}
      filterText={filterText}
      onFilterText={setFilterText}
      onListKeyDown={onListKeyDown}
      stateLocal={stateLocal}
      visibleLocal={visibleLocal}
      localKey={(issue) => issue.id}
      isLocalActive={(issue) =>
        selectedIssue?.kind === "local" && selectedIssue.id === issue.id
      }
      onSelectLocal={(issue) => selectIssue({ kind: "local", id: issue.id })}
      renderLocalRow={(issue) => (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <RowIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate" title={issue.title}>
              {issue.title}
            </span>
          </p>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            local · {formatRelativeTime(issue.createdAt)}
            {issue.archived ? " · archived" : ""}
          </p>
        </>
      )}
      archivedLocalCount={archivedLocalCount}
      showArchived={showArchived}
      onToggleArchived={() => setShowArchived((v) => !v)}
      ghPending={gh.isPending}
      ghReady={ghReady}
      remoteNotReadySlot={
        isBitbucket ? <BitbucketIssuesSunset repoPath={repoPath} /> : undefined
      }
      listPending={issueList.isPending}
      stateRemote={issues}
      visibleRemote={visible}
      remoteKey={(issue) => String(issue.number)}
      isRemoteActive={(issue) =>
        selectedIssue?.kind === "remote" &&
        selectedIssue.id === String(issue.number)
      }
      onSelectRemote={(issue) =>
        selectIssue({ kind: "remote", id: String(issue.number) })
      }
      onRemoteHover={(issue) =>
        hoverPrefetch(() => prefetchIssue(issue.number))
      }
      renderRemoteRow={(issue) => (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <RowIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate" title={issue.title}>
              {issue.title}
            </span>
          </p>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            #{issue.number} · {issue.author ? `${issue.author.login} · ` : ""}
            {formatRelativeTime(issue.createdAt)}
          </p>
        </>
      )}
      remoteSkeletonRows={3}
      localNoun="issues"
      remoteNoun="issues"
    >
      <CreateIssueDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) setIssueDraft(undefined);
        }}
        initialDraft={issueDraft}
      />
      <CreateLocalIssueDialog
        repoPath={repoPath}
        open={createLocalOpen}
        onOpenChange={setCreateLocalOpen}
      />
    </ConversationListPanel>
  );
}
