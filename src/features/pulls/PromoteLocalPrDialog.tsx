import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { triggerAutomations } from "@/lib/automations/runner";
import { useCreatePr } from "@/lib/git/queries";
import type { LocalPr } from "@/lib/pulls/local";
import { useSaveLocalPr } from "@/lib/pulls/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/**
 * Publishes a local PR to GitHub: pushes the head branch, opens a real PR
 * with the same title/description, then closes the local PR with a comment
 * linking its successor.
 */
export function PromoteLocalPrDialog({
  repoPath,
  pr,
  commitSubjects,
  open,
  onOpenChange,
}: {
  repoPath: string;
  pr: LocalPr;
  commitSubjects: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createPr = useCreatePr(repoPath);
  const save = useSaveLocalPr(repoPath);
  const selectPr = useUiStore((s) => s.selectPr);
  const [draft, setDraft] = useState(false);
  const pending = createPr.isPending || save.isPending;

  async function promote() {
    try {
      const { number, url } = await createPr.mutateAsync({
        base: pr.base,
        head: pr.head,
        title: pr.title,
        body: pr.body,
        draft,
      });
      await save.mutateAsync({
        ...pr,
        status: "closed",
        comments: [
          ...pr.comments,
          {
            id: crypto.randomUUID(),
            body: `Promoted to GitHub pull request [#${number}](${url}).`,
            createdAt: new Date().toISOString(),
          },
        ],
      });
      toast.success(`Opened pull request #${number}`, {
        description: url,
        action: { label: "View", onClick: () => openUrl(url) },
      });
      onOpenChange(false);
      selectPr({ kind: "remote", id: String(number) });
      triggerAutomations({
        kind: "pr-open",
        repoPath,
        base: pr.base,
        head: pr.head,
        title: pr.title,
        body: pr.body,
        commitSubjects,
        target: { type: "remote", number },
      });
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish this pull request to GitHub?</DialogTitle>
          <DialogDescription>
            Pushes <span className="font-mono">{pr.head}</span> to origin and
            opens a pull request into{" "}
            <span className="font-mono">{pr.base}</span> with this title and
            description. The local PR is then closed with a link to its
            replacement; its comments stay here.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:items-center">
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={draft}
              onCheckedChange={(checked) => setDraft(checked === true)}
            />
            Create as draft
          </label>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={promote} disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {draft ? "Publish as draft" : "Publish to GitHub"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
