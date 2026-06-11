import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useCreatePr } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { MarkdownEditor } from "./MarkdownEditor";
import { useGeneratePrDescription } from "./useGeneratePrDescription";

export function CreatePrDialog({
  repoPath,
  base,
  head,
  commitSubjects,
  open,
  onOpenChange,
}: {
  repoPath: string;
  base: string;
  head: string;
  commitSubjects: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPr = useCreatePr(repoPath);
  const { generate, cancel, generating } = useGeneratePrDescription(repoPath);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [draft, setDraft] = useState(false);

  // Seed fields each time the dialog opens (title GitHub-style: the single
  // commit's subject, else blank). Keyed on `open` only so a background
  // refresh of the commit list can't clobber what the user is typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot on open
  useEffect(() => {
    if (!open) return;
    setTitle(commitSubjects.length === 1 ? commitSubjects[0] : "");
    setBody("");
    setDraft(false);
  }, [open]);

  function submit() {
    createPr.mutate(
      { base, head, title: title.trim(), body, draft },
      {
        onSuccess: ({ number, url }) => {
          toast.success(`Opened pull request #${number}`, {
            description: url,
            action: { label: "View", onClick: () => openUrl(url) },
          });
          onOpenChange(false);
        },
        onError: toastError,
      },
    );
  }

  const busy = createPr.isPending || generating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create pull request</DialogTitle>
          <DialogDescription>
            Pushes <span className="font-mono">{head}</span> and opens a PR into{" "}
            <span className="font-mono">{base}</span> on GitHub
            {commitSubjects.length > 0 &&
              ` — ${commitSubjects.length} commit${commitSubjects.length === 1 ? "" : "s"}`}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="pr-title">Title</Label>
          <Input
            id="pr-title"
            placeholder="Summarize the change"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pr-body">Description</Label>
          <MarkdownEditor
            id="pr-body"
            placeholder="Describe what changed and why"
            value={body}
            onChange={setBody}
            rows={8}
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
                  onClick={() =>
                    generate(base, head, commitSubjects, (d) => {
                      setTitle(d.title);
                      setBody(d.body);
                    })
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

        <DialogFooter className="sm:items-center">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={draft}
              onCheckedChange={(checked) => setDraft(checked === true)}
            />
            Create as draft
          </label>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || busy} onClick={submit}>
            {createPr.isPending && <Spinner data-icon="inline-start" />}
            {draft ? "Create draft" : "Create pull request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
