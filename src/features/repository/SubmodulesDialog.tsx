import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useSubmodules, useUpdateSubmodule } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";

const STATUS: Record<
  string,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  ok: { label: "Up to date", variant: "secondary" },
  uninitialized: { label: "Not initialized", variant: "outline" },
  modified: { label: "Modified", variant: "secondary" },
  conflict: { label: "Conflict", variant: "destructive" },
};

export function SubmodulesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const subs = useSubmodules(repoPath);
  const update = useUpdateSubmodule(repoPath);
  const list = subs.data ?? [];

  function doUpdate(path?: string) {
    update.mutate(path, {
      onSuccess: () =>
        toast.success(path ? `Updated ${path}` : "Submodules updated"),
      onError: toastError,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Submodules</DialogTitle>
          <DialogDescription>
            Initialize and update the submodules this repository references to
            the commit it records. Updating fetches over the network.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto border">
          {subs.isPending ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              This repository has no submodules.
            </p>
          ) : (
            list.map((s) => {
              const meta = STATUS[s.status] ?? {
                label: s.status,
                variant: "outline" as const,
              };
              return (
                <div
                  key={s.path}
                  className="flex items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono font-medium">{s.path}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {s.sha.slice(0, 7)}
                      {s.describe ? ` · ${s.describe}` : ""}
                    </p>
                  </div>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={update.isPending}
                    onClick={() => doUpdate(s.path)}
                  >
                    {s.status === "uninitialized" ? "Initialize" : "Update"}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={update.isPending || list.length === 0}
            onClick={() => doUpdate()}
          >
            {update.isPending && <Spinner data-icon="inline-start" />}
            Update all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
