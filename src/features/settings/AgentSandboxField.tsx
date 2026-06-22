import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import {
  type ContainerStatus,
  detectContainerSandbox,
  prepareContainerSandbox,
} from "@/lib/ai/sandbox";
import { toastError } from "@/lib/toast";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Opt-in control for running agent sessions inside a Docker/Podman container
 * (kernel-enforced filesystem confinement) instead of the host. Shows live
 * runtime status and offers a one-time image build when the engine is ready but
 * the agent image hasn't been built yet. The value is the `agentIsolation`
 * setting ("worktree" | "container").
 */
export function AgentSandboxField({
  value,
  onChange,
}: {
  value: "worktree" | "container";
  onChange: (value: "worktree" | "container") => void;
}) {
  const enabled = value === "container";
  const status = useQuery({
    queryKey: ["agentContainerStatus"],
    queryFn: detectContainerSandbox,
    staleTime: 30_000,
  });
  const queryClient = useQueryClient();
  const [building, setBuilding] = useState(false);

  async function buildImage() {
    setBuilding(true);
    try {
      await prepareContainerSandbox();
      toast.success("Agent container image built");
      await queryClient.invalidateQueries({
        queryKey: ["agentContainerStatus"],
      });
    } catch (e) {
      toastError(e);
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Checkbox
          checked={enabled}
          onCheckedChange={(c) =>
            onChange(c === true ? "container" : "worktree")
          }
        />
        Run agent sessions in an isolated container
      </label>
      <p className="text-xs text-muted-foreground">
        Sessions normally run inside a throwaway git worktree only. Turn this on
        to also run each session inside an ephemeral Docker/Podman container, so
        the agent's file writes are confined to the worktree by the kernel — the
        strongest isolation. Applies to sessions started afterward; needs Docker
        or Podman installed.
      </p>
      {enabled && (
        <StatusLine
          status={status.data}
          loading={status.isLoading}
          building={building}
          onBuild={buildImage}
        />
      )}
    </div>
  );
}

function StatusLine({
  status,
  loading,
  building,
  onBuild,
}: {
  status: ContainerStatus | undefined;
  loading: boolean;
  building: boolean;
  onBuild: () => void;
}) {
  if (loading) {
    return <Row tone="muted">Checking for Docker / Podman…</Row>;
  }
  if (!status || !status.runtime) {
    return (
      <Row tone="warn">
        No Docker or Podman found. Claude sessions still run on the host, but
        Codex sessions (which require a container) will fail until you install
        one.
      </Row>
    );
  }
  if (!status.ready) {
    return (
      <Row tone="warn">
        {cap(status.runtime)} is installed but its engine isn't running. Start
        it, then reopen Settings.
      </Row>
    );
  }
  if (!status.imagePresent) {
    return (
      <Row tone="muted">
        {cap(status.runtime)} ready — the agent image needs building once.
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={building}
          onClick={onBuild}
          className="ml-2"
        >
          {building ? (
            <>
              <Spinner className="size-3" />
              Building…
            </>
          ) : (
            "Build image"
          )}
        </Button>
      </Row>
    );
  }
  return (
    <Row tone="ok">
      {cap(status.runtime)} ready, image built — new sessions run in a
      container.
    </Row>
  );
}

/** A status line: icon + text (never color alone). */
function Row({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const Icon = tone === "ok" ? CheckCircleIcon : WarningCircleIcon;
  // Success uses the app's green (matching the provider "Connected" line);
  // warnings stay full-contrast; informational lines are muted.
  const toneClass =
    tone === "ok"
      ? "text-green-600 dark:text-green-400"
      : tone === "warn"
        ? "text-foreground"
        : "text-muted-foreground";
  return (
    <p className={`flex items-center gap-1.5 text-[11px] ${toneClass}`}>
      {tone !== "muted" && (
        <Icon weight="fill" className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}
