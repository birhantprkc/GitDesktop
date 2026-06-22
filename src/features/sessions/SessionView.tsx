import { SparkleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BranchDiffView } from "@/features/compare/BranchDiffView";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import { SessionActivation } from "./SessionActivation";
import { SessionConversation } from "./SessionConversation";
import { StatusIndicator } from "./status";
import { type AgentSession, useSessionsStore } from "./store";

type Segment = "conversation" | "changes";

/**
 * The agent "canvas". With no session selected it's the new-session activation
 * panel; with one selected it's a focused two-pane workspace — a header
 * (title, status, branch, Keep / Discard) over a segmented Conversation |
 * Changes view. Keyed by session id upstream so per-session view state resets.
 */
export function SessionView({ repoPath }: { repoPath: string }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeId);
  // activeId is global; only adopt it when the session belongs to this repo.
  const active =
    sessions.find((s) => s.id === activeId && s.repoPath === repoPath) ?? null;

  if (!active) return <SessionActivation repoPath={repoPath} />;
  return <SessionCanvas key={active.id} session={active} repoPath={repoPath} />;
}

function SessionCanvas({
  session,
  repoPath,
}: {
  session: AgentSession;
  repoPath: string;
}) {
  const busyId = useSessionsStore((s) => s.busyId);
  const keep = useSessionsStore((s) => s.keep);
  const resume = useSessionsStore((s) => s.resume);
  const discard = useSessionsStore((s) => s.discard);
  const deleteSession = useSessionsStore((s) => s.deleteSession);
  const [segment, setSegment] = useState<Segment>("conversation");
  const [squash, setSquash] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const kept = session.kept;
  const hasCommits = kept || session.headHash !== session.base;
  const commitCount = session.turns.filter((t) => t.commitHash).length;
  // Actions are disabled while the agent runs or a keep/resume/discard is mid-flight.
  const blocked = session.running || busyId === session.id;
  const title = session.turns[0]?.prompt.trim() || "Agent session";

  const doKeep = () => {
    if (!blocked && !kept && hasCommits) keep(session.id, squash);
  };
  // Discarding deletes the worktree AND branch — confirm when there's work to
  // lose; an empty session (no commits) is a harmless cleanup, so skip the gate.
  const doDiscard = () => {
    if (blocked || kept) return;
    if (hasCommits) setConfirmDiscard(true);
    else discard(session.id);
  };
  const doResume = () => {
    if (!blocked && kept) resume(session.id);
  };
  const doDelete = () => {
    if (!blocked && kept) setConfirmDelete(true);
  };
  const toggleView = () =>
    setSegment((s) => (s === "conversation" ? "changes" : "conversation"));

  useHotkeyAction(
    "agent-keep-session",
    doKeep,
    !blocked && !kept && hasCommits,
  );
  useHotkeyAction("agent-discard-session", doDiscard, !blocked && !kept);
  useHotkeyAction("agent-resume-session", doResume, !blocked && kept);
  useHotkeyAction("agent-delete-session", doDelete, !blocked && kept);
  useHotkeyAction("agent-toggle-view", toggleView);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b">
        <div className="flex items-start gap-3 px-3 pt-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xs font-medium" title={title}>
              {title}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <StatusIndicator session={session} />
              <span className="text-muted-foreground" aria-hidden>
                ·
              </span>
              <span
                className="truncate font-mono text-muted-foreground"
                title={session.branch}
              >
                {session.branch}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {kept ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={doDelete}
                >
                  Delete
                </Button>
                <Button size="sm" disabled={blocked} onClick={doResume}>
                  Resume
                </Button>
              </>
            ) : (
              <>
                {commitCount > 1 && (
                  <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
                    <Checkbox
                      checked={squash}
                      onCheckedChange={(v) => setSquash(v === true)}
                    />
                    Squash {commitCount}
                  </label>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={doDiscard}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  disabled={blocked || !hasCommits}
                  onClick={doKeep}
                >
                  Keep
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="px-3 py-2.5">
          <Tabs value={segment} onValueChange={(v) => setSegment(v as Segment)}>
            <TabsList>
              <TabsTrigger value="conversation">Conversation</TabsTrigger>
              <TabsTrigger value="changes">
                Changes
                {hasCommits && (
                  <>
                    <span
                      className="ml-1.5 size-1.5 rounded-full bg-current"
                      aria-hidden
                    />
                    <span className="sr-only"> (changes ready to review)</span>
                  </>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {segment === "conversation" ? (
          <SessionConversation session={session} repoPath={repoPath} />
        ) : (
          <SessionChanges session={session} />
        )}
      </div>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this session?</DialogTitle>
            <DialogDescription>
              The agent's work on{" "}
              <span className="font-mono">{session.branch}</span> will be
              permanently deleted — its worktree and branch are removed. This
              can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                discard(session.id);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this session?</DialogTitle>
            <DialogDescription>
              This removes the session and its conversation from the app. The
              work stays on branch{" "}
              <span className="font-mono">{session.branch}</span> — delete that
              from Branches if you no longer need it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false);
                deleteSession(session.id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionChanges({ session }: { session: AgentSession }) {
  const hasCommits = session.kept || session.headHash !== session.base;
  if (!hasCommits) {
    return (
      <DiffPlaceholder
        icon={SparkleIcon}
        message={
          session.running
            ? "The agent is working — changes appear here once a turn commits."
            : "No changes yet. Send the agent a task in Conversation."
        }
      />
    );
  }
  // Diff `base..branch` (not the cached headHash, which goes stale after a Keep
  // squashes the checkpoints). A kept session has no worktree, but its branch +
  // commits live in the shared object database, so read it from the main repo.
  return (
    <BranchDiffView
      repoPath={session.kept ? session.repoPath : session.worktreePath}
      base={session.base}
      compare={session.branch}
    />
  );
}
