import {
  CaretDownIcon,
  GitBranchIcon,
  GitCommitIcon,
  PlusIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Markdown } from "@/components/ui/markdown";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAppForm } from "@/lib/form";
import {
  useBranches,
  useCreateRelease,
  useGithubReleaseNotes,
  useRecentCommits,
  useRepoStatus,
  useTagList,
} from "@/lib/git/queries";
import type { CommitSummary } from "@/lib/git/types";
import { listKeyboardNav } from "@/lib/list-keyboard-nav";
import { useAiEnabled } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useGenerateReleaseNotes } from "./useGenerateReleaseNotes";
import { findPreviousTag } from "./version";

const RELEASE_DEFAULTS = {
  tag: "",
  title: "",
  notes: "",
  target: "",
  prerelease: false,
  latest: false,
  draft: false,
};

/**
 * Creates a GitHub release. The tag is a combobox — pick an existing tag, or
 * type a new one and click "Create new tag" to persist it (a Base UI combobox
 * reverts a free-typed value on blur, so the new tag must become a real item).
 * A newly-created tag exposes the tabbed Target picker (branches / recent
 * commits, à la GitHub). Notes can be hand-written (live Preview) or generated
 * from GitHub's auto-notes / AI relative to a previous tag we resolve via semver
 * and let the user override. Form state lives in `useAppForm`; the previous tag
 * is generation-only (not a create input) so it stays derived local state.
 */
export function CreateReleaseDialog({
  repoPath,
  open,
  onOpenChange,
  initialTag,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill + lock the tag (creating a release for an existing tag). */
  initialTag?: string;
}) {
  const createRelease = useCreateRelease(repoPath);
  const githubNotes = useGithubReleaseNotes(repoPath);
  const aiNotes = useGenerateReleaseNotes(repoPath);
  const status = useRepoStatus(repoPath);
  const tagList = useTagList(repoPath);
  const branches = useBranches(repoPath);
  const recent = useRecentCommits(repoPath, 50, open);
  const aiEnabled = useAiEnabled();
  const selectTag = useUiStore((s) => s.selectTag);
  const repoName = useUiStore((s) => s.repoName) ?? "";
  const branch = status.data?.branch?.name ?? "";
  const existingTags = tagList.data ?? [];
  const tagNames = existingTags.map((t) => t.name);

  // Ephemeral UI state (not release inputs): the tag combobox's created entries
  // and open state, the previous-tag override (null = use the resolved default),
  // and which notes tab is showing.
  const [createdTags, setCreatedTags] = useState<string[]>([]);
  const [tagOpen, setTagOpen] = useState(false);
  const [previousTagOverride, setPreviousTagOverride] = useState<string | null>(
    null,
  );
  const [notesTab, setNotesTab] = useState<"write" | "preview">("write");

  const form = useAppForm({
    defaultValues: RELEASE_DEFAULTS,
    onSubmit: async ({ value }) => {
      const tag = value.tag.trim();
      if (!tag) return;
      const hasTarget = !initialTag && createdTags.includes(tag);
      try {
        const url = await createRelease.mutateAsync({
          tag,
          title: value.title.trim(),
          notes: value.notes,
          target: hasTarget ? value.target.trim() : "",
          prerelease: value.prerelease,
          draft: value.draft,
          latest: value.latest,
        });
        toast.success(value.draft ? "Draft saved" : `Released ${tag}`, {
          description: url,
          action: { label: "View", onClick: () => openUrl(url) },
        });
        onOpenChange(false);
        selectTag({ tag });
      } catch (e) {
        toastError(e);
      }
    },
  });

  const tag = useSelector(form.store, (s) => s.values.tag);
  const target = useSelector(form.store, (s) => s.values.target);
  const notes = useSelector(form.store, (s) => s.values.notes);
  const draft = useSelector(form.store, (s) => s.values.draft);
  const tagTrimmed = tag.trim();

  // The tag combobox items must include user-created tags so a typed value
  // persists past blur. "Create" shows while the typed value is genuinely new.
  const tagItems = [...createdTags, ...tagNames].map((name) => ({ name }));
  const isExistingTag = tagNames.includes(tagTrimmed);
  const canCreate =
    !!tagTrimmed && !isExistingTag && !createdTags.includes(tagTrimmed);
  // Target only matters for a NEW (created) tag — and only once it's persisted,
  // so interacting with the target can't revert the tag input.
  const showTarget = !initialTag && createdTags.includes(tagTrimmed);

  // Previous tag for generated notes: the user's override, else the semver
  // resolution. Derived (not effect-synced) so it can't go stale across reopens.
  const defaultPreviousTag = findPreviousTag(tagTrimmed, tagNames);
  const previousTag = previousTagOverride ?? defaultPreviousTag;
  const effectivePreviousTag = tagNames.includes(previousTag.trim())
    ? previousTag.trim()
    : "";

  const seedOnOpen = useEffectEvent(() => {
    form.reset(
      {
        ...RELEASE_DEFAULTS,
        tag: initialTag ?? "",
        target: initialTag ? "" : branch,
      },
      { keepDefaultValues: true },
    );
    setCreatedTags([]);
    setPreviousTagOverride(null);
    setNotesTab("write");
  });
  useEffect(() => {
    if (open) seedOnOpen();
  }, [open]);

  function createNewTag(name: string) {
    const n = name.trim();
    if (!n) return;
    if (!isExistingTag && !createdTags.includes(n)) {
      setCreatedTags((p) => [n, ...p]);
    }
    form.setFieldValue("tag", n);
    setTagOpen(false);
  }

  const busyGenerating = githubNotes.isPending || aiNotes.generating;

  function generateFromGithub() {
    if (!tagTrimmed) return;
    githubNotes.mutate(
      {
        tag: tagTrimmed,
        target: showTarget ? target.trim() : "",
        previousTag: effectivePreviousTag,
      },
      {
        onSuccess: (gen) => {
          if (gen.body) form.setFieldValue("notes", gen.body);
          if (gen.name && !form.getFieldValue("title").trim()) {
            form.setFieldValue("title", gen.name);
          }
          setNotesTab("preview");
        },
        onError: toastError,
      },
    );
  }

  function generateWithAi() {
    if (!tagTrimmed) return;
    form.setFieldValue("notes", "");
    aiNotes.generate({
      tag: tagTrimmed,
      target: showTarget ? target.trim() : tagTrimmed,
      previousTag: effectivePreviousTag,
      repoName,
      onResult: (body) => form.setFieldValue("notes", body),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <form
          className="flex min-h-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {initialTag ? `Release ${initialTag}` : "New release"}
            </DialogTitle>
            <DialogDescription>
              Publishes a GitHub release. A new tag is created from the target
              on publish.
            </DialogDescription>
          </DialogHeader>

          {/* Fields scroll; header and submit footer stay pinned. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rel-tag">Tag</Label>
                {initialTag ? (
                  <Input
                    id="rel-tag"
                    value={tag}
                    disabled
                    className="font-mono"
                  />
                ) : (
                  <Combobox
                    items={tagItems}
                    itemToStringLabel={(t: { name: string }) => t.name}
                    inputValue={tag}
                    onInputValueChange={(v: string) =>
                      form.setFieldValue("tag", v)
                    }
                    value={tagItems.find((t) => t.name === tagTrimmed) ?? null}
                    onValueChange={(t: { name: string } | null) =>
                      t && form.setFieldValue("tag", t.name)
                    }
                    open={tagOpen}
                    onOpenChange={setTagOpen}
                    openOnInputClick
                  >
                    <ComboboxInput
                      className="w-full font-mono"
                      placeholder="v1.2.0"
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>
                        {canCreate ? null : "No matching tags."}
                      </ComboboxEmpty>
                      <ComboboxList>
                        {(t: { name: string }) => (
                          <ComboboxItem key={t.name} value={t}>
                            <span className="truncate font-mono">{t.name}</span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                      {canCreate && (
                        <button
                          type="button"
                          onClick={() => createNewTag(tagTrimmed)}
                          className="flex w-full items-center gap-1.5 border-t px-2 py-2 text-left text-xs hover:bg-accent"
                        >
                          <PlusIcon className="size-3.5 shrink-0" />
                          Create new tag{" "}
                          <span className="font-mono">{tagTrimmed}</span> on
                          release
                        </button>
                      )}
                    </ComboboxContent>
                  </Combobox>
                )}
              </div>
              {showTarget && (
                <div className="space-y-1.5">
                  <Label>Target</Label>
                  <TargetPicker
                    branches={(branches.data ?? []).map((b) => b.name)}
                    commits={recent.data ?? []}
                    value={target}
                    onChange={(v) => form.setFieldValue("target", v)}
                  />
                </div>
              )}
            </div>

            <form.AppField name="title">
              {(field) => (
                <field.TextField
                  label="Title (optional)"
                  placeholder={tagTrimmed || "Release title"}
                />
              )}
            </form.AppField>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Release notes</Label>
                {existingTags.length > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="shrink-0">Previous tag</span>
                    <Combobox
                      items={tagNames.map((name) => ({ name }))}
                      itemToStringLabel={(t: { name: string }) => t.name}
                      inputValue={previousTag}
                      onInputValueChange={setPreviousTagOverride}
                      value={
                        existingTags.find(
                          (t) => t.name === previousTag.trim(),
                        ) ?? null
                      }
                      onValueChange={(t: { name: string } | null) =>
                        setPreviousTagOverride(t ? t.name : "")
                      }
                      openOnInputClick
                    >
                      <ComboboxInput
                        className="h-7 w-64 font-mono text-xs"
                        placeholder="Automatic"
                      />
                      <ComboboxContent>
                        <ComboboxEmpty>No matching tags.</ComboboxEmpty>
                        <ComboboxList>
                          {(t: { name: string }) => (
                            <ComboboxItem key={t.name} value={t}>
                              <span className="truncate font-mono">
                                {t.name}
                              </span>
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  </div>
                )}
              </div>
              <Tabs
                value={notesTab}
                onValueChange={(v) => setNotesTab(v as "write" | "preview")}
              >
                <div className="flex items-center gap-2">
                  <TabsList variant="line">
                    <TabsTrigger value="write">Write</TabsTrigger>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                  </TabsList>
                  <span className="flex-1" />
                  {busyGenerating ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => aiNotes.cancel()}
                    >
                      {githubNotes.isPending ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <XIcon data-icon="inline-start" />
                      )}
                      {githubNotes.isPending ? "Generating…" : "Cancel"}
                    </Button>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            disabled={!tagTrimmed}
                          />
                        }
                      >
                        <SparkleIcon data-icon="inline-start" />
                        Generate notes
                        <CaretDownIcon data-icon="inline-end" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-56">
                        <DropdownMenuItem onClick={generateFromGithub}>
                          From GitHub (commits & PRs)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={!aiEnabled}
                          title={
                            aiEnabled
                              ? undefined
                              : "Enable AI in Settings first."
                          }
                          onClick={generateWithAi}
                        >
                          Summarize with AI
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <TabsContent value="write">
                  <Textarea
                    value={notes}
                    onChange={(e) =>
                      form.setFieldValue("notes", e.target.value)
                    }
                    placeholder="What's changed… (or generate notes above)"
                    rows={8}
                    className="max-h-72 min-h-32 resize-y font-mono"
                  />
                </TabsContent>
                <TabsContent value="preview">
                  <div className="max-h-72 min-h-32 overflow-auto rounded-none border p-3">
                    {notes.trim() ? (
                      <Markdown>{notes}</Markdown>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Nothing to preview yet.
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <form.AppField name="latest">
                {(field) => (
                  <field.CheckboxField
                    label="Set as the latest release"
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  />
                )}
              </form.AppField>
              <form.AppField name="prerelease">
                {(field) => (
                  <field.CheckboxField
                    label="Pre-release"
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  />
                )}
              </form.AppField>
              <form.AppField name="draft">
                {(field) => (
                  <field.CheckboxField
                    label="Save as draft"
                    className="flex cursor-pointer items-center gap-2 text-xs"
                  />
                )}
              </form.AppField>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <form.AppForm>
              <form.SubmitButton disabled={!tagTrimmed || busyGenerating}>
                {draft ? "Save draft" : "Publish release"}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * GitHub-style release target picker: a button that opens a popover with a
 * filter and Branches / Recent Commits tabs. Picking a row sets the target and
 * closes. Arrow keys move within the active tab's list.
 */
function TargetPicker({
  branches,
  commits,
  value,
  onChange,
}: {
  branches: string[];
  commits: CommitSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"branches" | "commits">("branches");
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const q = filter.trim().toLowerCase();
  const isBranch = branches.includes(value);
  const selectedCommit = commits.find((c) => c.hash === value);

  const rows: { key: string; node: React.ReactNode }[] =
    tab === "branches"
      ? branches
          .filter((b) => b.toLowerCase().includes(q))
          .map((b) => ({
            key: b,
            node: (
              <>
                <GitBranchIcon className="shrink-0 text-muted-foreground" />
                <span className="truncate font-mono">{b}</span>
              </>
            ),
          }))
      : commits
          .filter(
            (c) => c.hash.startsWith(q) || c.subject.toLowerCase().includes(q),
          )
          .map((c) => ({
            key: c.hash,
            node: (
              <>
                <GitCommitIcon className="mt-0.5 shrink-0 self-start text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.subject}</span>
                  <span className="text-muted-foreground">
                    <span className="font-mono">{c.hash.slice(0, 7)}</span> ·{" "}
                    {formatRelativeTime(c.date)}
                  </span>
                </span>
              </>
            ),
          }));

  function pick(key: string) {
    onChange(key);
    setOpen(false);
  }

  const onKeyDown = listKeyboardNav({
    items: rows,
    activeIndex,
    onActivate: (_row, to) => setActiveIndex(to),
    rowKey: (r) => r.key,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setFilter("");
          setActiveIndex(-1);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start gap-2 font-normal"
          />
        }
      >
        {isBranch ? (
          <GitBranchIcon className="shrink-0 text-muted-foreground" />
        ) : (
          <GitCommitIcon className="shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono">
          {value
            ? isBranch
              ? value
              : `${value.slice(0, 7)}${
                  selectedCommit ? ` ${selectedCommit.subject}` : ""
                }`
            : "Choose a target"}
        </span>
        <CaretDownIcon className="ml-auto shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 p-0">
        <div className="p-2">
          <Input
            autoFocus
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActiveIndex(-1);
            }}
            placeholder={
              tab === "branches" ? "Filter branches…" : "Filter recent commits…"
            }
            className="h-8"
          />
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "branches" | "commits");
            setActiveIndex(-1);
          }}
        >
          <TabsList variant="line" className="px-2">
            <TabsTrigger value="branches">Branches</TabsTrigger>
            <TabsTrigger value="commits">Recent Commits</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-0">
            <div onKeyDown={onKeyDown} className="max-h-64 overflow-y-auto p-1">
              {rows.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  data-row={r.key}
                  onClick={() => pick(r.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      pick(r.key);
                    }
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs outline-hidden hover:bg-accent focus:bg-accent",
                    value === r.key && "bg-accent/50",
                  )}
                >
                  {r.node}
                </button>
              ))}
              {rows.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No matches.
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
