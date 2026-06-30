import { CheckCircleIcon, CircleDashedIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ConversationFilterPopover } from "@/features/conversations/ConversationFilterPopover";
import { ConversationListPanel } from "@/features/conversations/ConversationListPanel";
import { useLocalRemoteFilter } from "@/features/conversations/useLocalRemoteFilter";
import type { IssueStateFilter } from "@/lib/git/api";
import {
  forgeFeatureReady,
  useForgeStatus,
  useHoverPrefetch,
  useIssueList,
  usePrefetchIssue,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { useLocalIssues } from "@/lib/issues/queries";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { CreateLocalIssueDialog } from "./CreateLocalIssueDialog";

export function IssuesPanel({ repoPath }: { repoPath: string }) {
  const gh = useForgeStatus(repoPath);
  const provider = gh.data?.provider;
  const isGitLab = provider === "gitlab";
  const remoteLabel =
    provider === "gitlab"
      ? "GitLab"
      : provider === "bitbucket"
        ? "Bitbucket"
        : "GitHub";
  // Issues are GitHub-only so far; a ready GitLab repo degrades to "coming soon".
  const ghReady = forgeFeatureReady(gh.data, "issues");
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
  useHotkeyAction("create-issue", () => setCreateOpen(true), ghReady);

  // "Reference in new issue" (from a discussion) seeds + opens the GitHub create.
  useEffect(() => {
    if (pendingIssueDraft) {
      setIssueDraft(pendingIssueDraft);
      setCreateOpen(true);
      setPendingIssueDraft(null);
    }
  }, [pendingIssueDraft, setPendingIssueDraft]);

  // Opened from the command palette / New menu via requestCreate (works from any
  // tab — RepositoryView switches here first, then this fires).
  useEffect(() => {
    if (pendingCreate === "issue") {
      setCreateOpen(true);
      clearPendingCreate();
    } else if (pendingCreate === "local-issue") {
      setCreateLocalOpen(true);
      clearPendingCreate();
    }
  }, [pendingCreate, clearPendingCreate]);

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
        ghLabel: isGitLab ? "Issue on GitLab…" : "Issue on GitHub…",
        ghDisabled: !ghReady,
        ghReason: ghReady
          ? undefined
          : isGitLab
            ? "GitDesktop doesn't support GitLab issues yet — it's coming."
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
