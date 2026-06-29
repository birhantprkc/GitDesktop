import { GitPullRequestIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ConversationFilterPopover } from "@/features/conversations/ConversationFilterPopover";
import { ConversationListPanel } from "@/features/conversations/ConversationListPanel";
import { useLocalRemoteFilter } from "@/features/conversations/useLocalRemoteFilter";
import type { PrStateFilter } from "@/lib/git/api";
import {
  useForgeStatus,
  useHoverPrefetch,
  usePrefetchPr,
  usePrList,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useLocalPrs } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { CreateLocalPrDialog } from "./CreateLocalPrDialog";
import { CreatePrDialog } from "./CreatePrDialog";
import { useReconcileLocalPrs } from "./useReconcileLocalPrs";

export function PullRequestsPanel({ repoPath }: { repoPath: string }) {
  const gh = useForgeStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  // "closed" matches GitHub's Closed tab: closed and merged PRs alike.
  const [stateFilter, setStateFilter] = useState<PrStateFilter>("open");
  const prList = usePrList(repoPath, ghReady, stateFilter);
  const localPrs = useLocalPrs(repoPath);
  // Mark local PRs merged when their branch was merged outside the app.
  useReconcileLocalPrs(repoPath);
  const selectedPr = useUiStore((s) => s.selectedPr);
  const selectPr = useUiStore((s) => s.selectPr);
  const prefetchPr = usePrefetchPr(repoPath);
  const hoverPrefetch = useHoverPrefetch();
  const [createOpen, setCreateOpen] = useState(false);
  const [ghCreateOpen, setGhCreateOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
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
    stateRemote,
    visibleLocal,
    archivedLocalCount,
    visibleRemote,
    authorCount,
    labelCount,
  } = useLocalRemoteFilter({
    locals: localPrs.data ?? [],
    remotes: prList.data ?? [],
    stateFilter,
  });

  // The dialog picks the head/base branches itself (so main → staging works
  // just as well as feature → main), so the only requirement here is that the
  // repo is actually on GitHub.
  const ghCreateReason = ghReady
    ? null
    : "Connect this repository to GitHub to open a pull request here.";
  const canCreateGhPr = ghReady;
  const pendingCreate = useUiStore((s) => s.pendingCreate);
  const clearPendingCreate = useUiStore((s) => s.clearPendingCreate);

  useHotkeyAction("focus-filter", () => filterRef.current?.focus());
  useHotkeyAction("create-local-pr", () => setCreateOpen(true));
  useHotkeyAction("create-pr", () => setGhCreateOpen(true), canCreateGhPr);

  // Opened from the command palette / New menu via requestCreate (any tab).
  useEffect(() => {
    if (pendingCreate === "pr") {
      setGhCreateOpen(true);
      clearPendingCreate();
    } else if (pendingCreate === "local-pr") {
      setCreateOpen(true);
      clearPendingCreate();
    }
  }, [pendingCreate, clearPendingCreate]);

  // Arrow keys walk the visible rows, local section first like the list.
  const navTargets = [
    ...visibleLocal.map((pr) => ({ kind: "local" as const, id: pr.id })),
    ...visibleRemote.map((pr) => ({
      kind: "remote" as const,
      id: String(pr.number),
    })),
  ];

  const onListKeyDown = listKeyboardNav({
    items: navTargets,
    activeIndex: navTargets.findIndex(
      (t) => t.kind === selectedPr?.kind && t.id === selectedPr.id,
    ),
    onActivate: (target) => selectPr(target),
    rowKey: (target) => `${target.kind}:${target.id}`,
  });

  return (
    <ConversationListPanel
      repoPath={repoPath}
      feature="pull requests"
      stateFilter={stateFilter}
      onStateFilter={setStateFilter}
      newMenu={{
        ghLabel: "Pull request on GitHub…",
        ghDisabled: !canCreateGhPr,
        ghReason: ghCreateReason ?? undefined,
        onGh: () => setGhCreateOpen(true),
        localLabel: "Local pull request…",
        onLocal: () => setCreateOpen(true),
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
      localKey={(pr) => pr.id}
      isLocalActive={(pr) =>
        selectedPr?.kind === "local" && selectedPr.id === pr.id
      }
      onSelectLocal={(pr) => selectPr({ kind: "local", id: pr.id })}
      renderLocalRow={(pr) => (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate" title={pr.title}>
              {pr.title}
            </span>
            {pr.status !== "open" && (
              <Badge variant="secondary" className="capitalize">
                {pr.status}
              </Badge>
            )}
          </p>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            {pr.head} → {pr.base}
            {pr.archived ? " · archived" : ""}
          </p>
        </>
      )}
      archivedLocalCount={archivedLocalCount}
      showArchived={showArchived}
      onToggleArchived={() => setShowArchived((v) => !v)}
      ghPending={gh.isPending}
      ghReady={ghReady}
      listPending={prList.isPending}
      stateRemote={stateRemote}
      visibleRemote={visibleRemote}
      remoteKey={(pr) => String(pr.number)}
      isRemoteActive={(pr) =>
        selectedPr?.kind === "remote" && selectedPr.id === String(pr.number)
      }
      onSelectRemote={(pr) =>
        selectPr({ kind: "remote", id: String(pr.number) })
      }
      onRemoteHover={(pr) => hoverPrefetch(() => prefetchPr(pr.number))}
      renderRemoteRow={(pr) => (
        <>
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate" title={pr.title}>
              {pr.title}
            </span>
            {pr.isDraft && <Badge variant="secondary">draft</Badge>}
            {pr.state !== "OPEN" && (
              <Badge variant="secondary" className="capitalize">
                {pr.state.toLowerCase()}
              </Badge>
            )}
          </p>
          <p className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground">
            #{pr.number} · {pr.author ? `${pr.author.login} · ` : ""}
            {pr.headRefName} → {pr.baseRefName}
          </p>
        </>
      )}
      remoteSkeletonRows={2}
      localNoun="pull requests"
      remoteNoun="pull requests"
    >
      <CreateLocalPrDialog
        repoPath={repoPath}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <CreatePrDialog
        repoPath={repoPath}
        open={ghCreateOpen}
        onOpenChange={setGhCreateOpen}
      />
    </ConversationListPanel>
  );
}
