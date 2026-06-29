import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { toast } from "sonner";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  useCheckoutCommit,
  useDeleteRelease,
  useDeleteReleaseAsset,
  useDeleteTag,
  useDownloadReleaseAsset,
  useEditRelease,
  useForgeStatus,
  usePushTag,
  useReleaseDetails,
  useReleaseList,
  useTagList,
  useUploadReleaseAsset,
} from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { CreateReleaseDialog } from "./CreateReleaseDialog";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function TagDetailView({
  repoPath,
  tag,
}: {
  repoPath: string;
  tag: string;
}) {
  const gh = useForgeStatus(repoPath);
  const ghReady = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  // Only ask GitHub for a release when connected; otherwise it's just a tag.
  const release = useReleaseDetails(repoPath, ghReady ? tag : null);
  const tagList = useTagList(repoPath);
  const releaseList = useReleaseList(repoPath, ghReady);
  const editRelease = useEditRelease(repoPath);
  const deleteRelease = useDeleteRelease(repoPath);
  const uploadAsset = useUploadReleaseAsset(repoPath);
  const deleteAsset = useDeleteReleaseAsset(repoPath);
  const downloadAsset = useDownloadReleaseAsset(repoPath);
  const pushTag = usePushTag(repoPath);
  const deleteTag = useDeleteTag(repoPath);
  const checkout = useCheckoutCommit(repoPath);
  const selectTag = useUiStore((s) => s.selectTag);

  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPrerelease, setEditPrerelease] = useState(false);
  const [editLatest, setEditLatest] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cleanupTag, setCleanupTag] = useState(false);
  const [createReleaseOpen, setCreateReleaseOpen] = useState(false);
  const [deleteTagOpen, setDeleteTagOpen] = useState(false);
  const [deleteTagRemote, setDeleteTagRemote] = useState(false);

  const onError = (e: unknown) => toastError(e);
  const rel = release.data;
  const tagInfo = tagList.data?.find((t) => t.name === tag);
  const isLatest =
    (releaseList.data ?? []).find((r) => r.tagName === tag)?.isLatest ?? false;

  if (release.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  async function onUpload() {
    const file = await openDialog({ multiple: false });
    if (typeof file !== "string") return;
    uploadAsset.mutate(
      { tag, filePath: file },
      { onSuccess: () => toast.success("Asset uploaded"), onError },
    );
  }

  async function onDownload(assetName: string) {
    const dir = await openDialog({ directory: true });
    if (typeof dir !== "string") return;
    downloadAsset.mutate(
      { tag, assetName, dir },
      { onSuccess: () => toast.success(`Downloaded ${assetName}`), onError },
    );
  }

  // ── Release view ───────────────────────────────────────────────────────────
  if (rel) {
    return (
      <div className="flex h-full flex-col">
        <header className="space-y-2 border-b px-4 py-3">
          <div className="flex items-start gap-2">
            <h2 className="text-sm font-medium">{rel.name || rel.tagName}</h2>
            <span className="flex-1" />
            {rel.isDraft && (
              <Button
                variant="outline"
                size="xs"
                disabled={editRelease.isPending}
                onClick={() =>
                  editRelease.mutate(
                    {
                      tag,
                      title: "",
                      notes: "",
                      prerelease: rel.isPrerelease,
                      draft: false,
                      latest: isLatest,
                    },
                    { onSuccess: () => toast.success("Published"), onError },
                  )
                }
              >
                Publish
              </Button>
            )}
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setEditTitle(rel.name);
                setEditNotes(rel.body);
                setEditPrerelease(rel.isPrerelease);
                setEditLatest(isLatest);
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setCleanupTag(false);
                setDeleteOpen(true);
              }}
            >
              Delete
            </Button>
            {rel.url && (
              <Button
                variant="outline"
                size="xs"
                onClick={() => openUrl(rel.url)}
                className="cursor-pointer"
              >
                <ArrowSquareOutIcon data-icon="inline-start" />
                GitHub
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{rel.tagName}</span>
            {isLatest && <Badge variant="default">Latest</Badge>}
            {rel.isPrerelease && <Badge variant="secondary">Pre-release</Badge>}
            {rel.isDraft && <Badge variant="secondary">Draft</Badge>}
            {rel.author && <span>• {rel.author}</span>}
            {rel.publishedAt && (
              <span>• released {formatRelativeTime(rel.publishedAt)}</span>
            )}
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-4">
            {rel.body.trim() ? (
              <Markdown>{rel.body}</Markdown>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No release notes.
              </p>
            )}

            <div className="space-y-1.5 border-t pt-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  Assets ({rel.assets.length})
                </h3>
                <span className="flex-1" />
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={uploadAsset.isPending}
                  onClick={onUpload}
                >
                  {uploadAsset.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <UploadSimpleIcon data-icon="inline-start" />
                  )}
                  Upload
                </Button>
              </div>
              {rel.assets.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No assets attached.
                </p>
              ) : (
                rel.assets.map((a) => (
                  <div
                    key={a.name}
                    className="group flex items-center gap-2 text-xs"
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-mono"
                      title={a.name}
                    >
                      {a.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {formatBytes(a.size)} · {a.downloadCount} ↓
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Download ${a.name}`}
                      onClick={() => onDownload(a.name)}
                    >
                      <DownloadSimpleIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Delete ${a.name}`}
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() =>
                        deleteAsset.mutate(
                          { tag, assetName: a.name },
                          {
                            onSuccess: () => toast.success("Asset deleted"),
                            onError,
                          },
                        )
                      }
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </ScrollArea>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
            <form
              className="flex min-h-0 flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                editRelease.mutate(
                  {
                    tag,
                    title: editTitle.trim(),
                    notes: editNotes,
                    prerelease: editPrerelease,
                    draft: rel.isDraft,
                    latest: editLatest,
                  },
                  {
                    onSuccess: () => {
                      toast.success("Release updated");
                      setEditOpen(false);
                    },
                    onError,
                  },
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>Edit release</DialogTitle>
                <DialogDescription>
                  Updates {rel.tagName} on GitHub.
                </DialogDescription>
              </DialogHeader>
              {/* Fields scroll; header and submit footer stay pinned. */}
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Title"
                />
                <MarkdownEditor
                  aria-label="Release notes"
                  value={editNotes}
                  onChange={setEditNotes}
                  placeholder="Notes…"
                  rows={8}
                  textareaClassName="max-h-72 min-h-24 resize-y font-mono"
                />
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Switch
                      checked={editPrerelease}
                      onCheckedChange={setEditPrerelease}
                    />
                    Pre-release
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Switch
                      checked={editLatest}
                      onCheckedChange={setEditLatest}
                    />
                    Latest release
                  </label>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={editRelease.isPending}>
                  {editRelease.isPending && (
                    <Spinner data-icon="inline-start" />
                  )}
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete release {rel.tagName}?</DialogTitle>
              <DialogDescription>
                Removes the GitHub release. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={cleanupTag}
                onCheckedChange={(c) => setCleanupTag(c === true)}
              />
              Also delete the <span className="font-mono">{rel.tagName}</span>{" "}
              tag
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteRelease.isPending}
                onClick={() =>
                  deleteRelease.mutate(
                    { tag, cleanupTag },
                    {
                      onSuccess: () => {
                        toast.success("Release deleted");
                        setDeleteOpen(false);
                        selectTag(null);
                      },
                      onError: (e) => {
                        onError(e);
                        setDeleteOpen(false);
                      },
                    },
                  )
                }
              >
                {deleteRelease.isPending && (
                  <Spinner data-icon="inline-start" />
                )}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Plain tag view (no release) ────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        <div className="flex items-start gap-2">
          <h2 className="font-mono text-sm font-medium">{tag}</h2>
          <span className="flex-1" />
          {ghReady && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => setCreateReleaseOpen(true)}
            >
              Create release
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {tagInfo?.annotated && <Badge variant="secondary">annotated</Badge>}
          {tagInfo?.target && (
            <span className="font-mono">{tagInfo.target.slice(0, 7)}</span>
          )}
          {tagInfo?.date && <span>• {formatRelativeTime(tagInfo.date)}</span>}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 p-4">
        {tagInfo?.subject ? (
          <p className="text-sm">{tagInfo.subject}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            No description for this tag.
          </p>
        )}
        {!ghReady && (
          <p className="text-[11px] text-muted-foreground">
            Connect this repository to GitHub to publish a release for this tag.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        <Button
          variant="outline"
          size="sm"
          disabled={!tagInfo?.target || checkout.isPending}
          onClick={() =>
            tagInfo?.target &&
            checkout.mutate(tagInfo.target, {
              onSuccess: () => toast.success(`Checked out ${tag}`),
              onError,
            })
          }
        >
          Checkout
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pushTag.isPending}
          onClick={() =>
            pushTag.mutate(tag, {
              onSuccess: () => toast.success(`Pushed ${tag}`),
              onError,
            })
          }
        >
          Push tag
        </Button>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDeleteTagRemote(false);
            setDeleteTagOpen(true);
          }}
        >
          Delete tag
        </Button>
      </div>

      <CreateReleaseDialog
        repoPath={repoPath}
        open={createReleaseOpen}
        onOpenChange={setCreateReleaseOpen}
        initialTag={tag}
      />

      <Dialog open={deleteTagOpen} onOpenChange={setDeleteTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag {tag}?</DialogTitle>
            <DialogDescription>
              Deletes the local tag. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={deleteTagRemote}
              onCheckedChange={(c) => setDeleteTagRemote(c === true)}
            />
            Also delete it from <span className="font-mono">origin</span>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTagOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteTag.isPending}
              onClick={() =>
                deleteTag.mutate(
                  { name: tag, onRemote: deleteTagRemote },
                  {
                    onSuccess: () => {
                      toast.success(`Deleted ${tag}`);
                      setDeleteTagOpen(false);
                      selectTag(null);
                    },
                    onError: (e) => {
                      onError(e);
                      setDeleteTagOpen(false);
                    },
                  },
                )
              }
            >
              {deleteTag.isPending && <Spinner data-icon="inline-start" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
