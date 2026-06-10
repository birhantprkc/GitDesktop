import {
  ArrowDownIcon,
  ArrowsClockwiseIcon,
  ArrowUpIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Spinner } from "@/components/ui/spinner";
import {
  useFetchRemote,
  usePull,
  usePush,
  useRepoStatus,
} from "@/lib/git/queries";
import { errorMessage } from "@/lib/tauri/invoke";

export function SyncControls({ repoPath }: { repoPath: string }) {
  const status = useRepoStatus(repoPath);
  const fetchRemote = useFetchRemote(repoPath);
  const pull = usePull(repoPath);
  const push = usePush(repoPath);

  const head = status.data?.branch;
  const hasUpstream = Boolean(head?.upstream);
  const busy = fetchRemote.isPending || pull.isPending || push.isPending;
  const onError = (e: unknown) => toast.error(errorMessage(e));

  return (
    <div className="flex items-center gap-2">
      {head && head.ahead > 0 && (
        <Badge variant="secondary">
          <ArrowUpIcon className="size-3" />
          {head.ahead}
        </Badge>
      )}
      {head && head.behind > 0 && (
        <Badge variant="secondary">
          <ArrowDownIcon className="size-3" />
          {head.behind}
        </Badge>
      )}
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fetchRemote.mutate(undefined, { onError })}
        >
          {fetchRemote.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowsClockwiseIcon data-icon="inline-start" />
          )}
          Fetch
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !hasUpstream}
          onClick={() => pull.mutate(undefined, { onError })}
        >
          {pull.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowDownIcon data-icon="inline-start" />
          )}
          Pull
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => push.mutate(!hasUpstream, { onError })}
        >
          {push.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ArrowUpIcon data-icon="inline-start" />
          )}
          {hasUpstream ? "Push" : "Publish branch"}
        </Button>
      </ButtonGroup>
    </div>
  );
}
