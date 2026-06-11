import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  useBranches,
  useCompareBranches,
  useDefaultBranch,
  useRepoStatus,
} from "@/lib/git/queries";
import { useCreateLocalPr } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { MarkdownEditor } from "./MarkdownEditor";
import { useGeneratePrDescription } from "./useGeneratePrDescription";

export function CreateLocalPrDialog({
  repoPath,
  defaultBase,
  defaultHead,
  open,
  onOpenChange,
}: {
  repoPath: string;
  defaultBase?: string;
  defaultHead?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const status = useRepoStatus(repoPath);
  const branches = useBranches(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const createPr = useCreateLocalPr(repoPath);
  const { generate, cancel, generating } = useGeneratePrDescription(repoPath);
  const selectPr = useUiStore((s) => s.selectPr);
  const setRepoTab = useUiStore((s) => s.setRepoTab);

  const currentName = status.data?.branch?.name ?? null;
  const names = (branches.data ?? []).map((b) => b.name);

  const [base, setBase] = useState("");
  const [head, setHead] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reseed on open
  useEffect(() => {
    if (!open) return;
    const h = defaultHead ?? currentName ?? names[0] ?? "";
    const fallbackBase =
      defaultBranch.data && defaultBranch.data !== h
        ? defaultBranch.data
        : (names.find((n) => n !== h) ?? "");
    setHead(h);
    setBase(defaultBase ?? fallbackBase);
    setTitle("");
    setBody("");
  }, [open]);

  const comparison = useCompareBranches(repoPath, base || null, head || null);
  const ahead = comparison.data?.ahead ?? [];
  const sameBranch = base === head;

  function submit() {
    createPr.mutate(
      { title: title.trim(), body, base, head },
      {
        onSuccess: (pr) => {
          toast.success(`Created local PR: ${pr.title}`);
          setRepoTab("pulls");
          selectPr({ kind: "local", id: pr.id });
          onOpenChange(false);
        },
        onError: toastError,
      },
    );
  }

  const items = Object.fromEntries(names.map((n) => [n, n]));
  const busy = createPr.isPending || generating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New local pull request</DialogTitle>
          <DialogDescription>
            Propose merging one branch into another and review it locally — no
            GitHub involved. Merge it later with a{" "}
            <span className="font-mono">--no-ff</span> commit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label>Merge</Label>
            <Select
              items={items}
              value={head || null}
              onValueChange={(v) => v && setHead(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {names.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="pb-2 text-xs text-muted-foreground">into</span>
          <div className="flex-1 space-y-1">
            <Label>Base</Label>
            <Select
              items={items}
              value={base || null}
              onValueChange={(v) => v && setBase(v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {names.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {sameBranch ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Pick two different branches.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {ahead.length} commit{ahead.length === 1 ? "" : "s"} to merge.
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="lpr-title">Title</Label>
          <Input
            id="lpr-title"
            placeholder="Summarize the change"
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lpr-body">Description</Label>
          <MarkdownEditor
            id="lpr-body"
            placeholder="Describe what changed and why"
            value={body}
            onChange={setBody}
            rows={7}
            textareaClassName="max-h-72 min-h-24 resize-y font-mono"
            actions={
              generating ? (
                <Button variant="outline" size="xs" onClick={cancel}>
                  <XIcon data-icon="inline-start" />
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={sameBranch || ahead.length === 0}
                  onClick={() =>
                    generate(
                      base,
                      head,
                      ahead.map((c) => c.subject),
                      (d) => {
                        setTitle(d.title);
                        setBody(d.body);
                      },
                    )
                  }
                  title="Generate the title and description with AI"
                >
                  <SparkleIcon data-icon="inline-start" />
                  Generate
                </Button>
              )
            }
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || sameBranch || busy}
            onClick={submit}
          >
            {createPr.isPending && <Spinner data-icon="inline-start" />}
            Create local PR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
