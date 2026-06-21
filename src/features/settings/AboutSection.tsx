import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { AuthStatus } from "@/lib/ai/agent";
import { type ToolStatus, useSystemHealth } from "@/lib/system/health";

/** Per-tool display metadata. `auth` marks tools that have a login concept;
 *  git (always local) doesn't. */
const TOOL_META: Record<
  string,
  { name: string; install: string; auth: boolean; role: string }
> = {
  git: {
    name: "Git",
    install: "https://git-scm.com/downloads",
    auth: false,
    role: "Required — powers every repository action.",
  },
  gh: {
    name: "GitHub CLI",
    install: "https://cli.github.com",
    auth: true,
    role: "GitHub pull requests, issues, discussions & Actions.",
  },
  glab: {
    name: "GitLab CLI",
    install: "https://gitlab.com/gitlab-org/cli",
    auth: true,
    role: "GitLab support.",
  },
  claude: {
    name: "Claude Code",
    install: "https://docs.anthropic.com/en/docs/claude-code/overview",
    auth: true,
    role: "Keyless AI review via your Claude subscription.",
  },
  codex: {
    name: "Codex CLI",
    install: "https://developers.openai.com/codex/cli/",
    auth: true,
    role: "Keyless AI review via your ChatGPT plan.",
  },
};

function AuthState({ authed }: { authed: AuthStatus }) {
  if (authed === "authed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <CheckCircleIcon
          weight="fill"
          className="size-3 text-emerald-600 dark:text-emerald-400"
        />
        Signed in
      </span>
    );
  }
  if (authed === "notAuthed") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <WarningCircleIcon
          weight="fill"
          className="size-3 text-amber-600 dark:text-amber-400"
        />
        Not signed in
      </span>
    );
  }
  return null;
}

function ToolRow({ tool }: { tool: ToolStatus }) {
  const meta = TOOL_META[tool.id];
  if (!meta) return null;
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {tool.found ? (
            <CheckCircleIcon
              weight="fill"
              className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <WarningCircleIcon
              weight="fill"
              className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
          )}
          <span className="font-medium">{meta.name}</span>
          <span className="text-muted-foreground">
            {tool.found ? "Installed" : "Not found"}
          </span>
          {meta.auth && tool.found && <AuthState authed={tool.authed} />}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {tool.found ? (
            <>
              {tool.version ?? "version unknown"}
              {tool.path ? (
                <>
                  {" · "}
                  <span className="font-mono">{tool.path}</span>
                </>
              ) : null}
            </>
          ) : (
            meta.role
          )}
        </p>
      </div>
      {!tool.found && (
        <Button
          variant="outline"
          size="xs"
          className="shrink-0 cursor-pointer"
          onClick={() => openUrl(meta.install)}
        >
          Install
          <ArrowSquareOutIcon data-icon="inline-end" />
        </Button>
      )}
    </li>
  );
}

/**
 * Settings → About: app/OS info plus the status of every external CLI
 * GitDesktop relies on (installed?, version, path, sign-in), with an Install
 * link for any that are missing.
 */
export function AboutSection() {
  const health = useSystemHealth();
  const appInfo = useQuery({
    queryKey: ["app-info"] as const,
    queryFn: async () => ({
      version: await getVersion(),
      tauri: await getTauriVersion(),
    }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const sys = health.data?.system;

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">About</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Your environment and the tools GitDesktop depends on. Several features
          quietly degrade when a CLI is missing or signed out.
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">App version</dt>
        <dd className="font-mono">{appInfo.data?.version ?? "…"}</dd>
        <dt className="text-muted-foreground">Operating system</dt>
        <dd>{sys ? `${sys.os} ${sys.osVersion} (${sys.arch})` : "…"}</dd>
        <dt className="text-muted-foreground">Tauri runtime</dt>
        <dd className="font-mono">{appInfo.data?.tauri ?? "…"}</dd>
      </dl>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">
            Components
          </h3>
          <Button
            variant="ghost"
            size="xs"
            disabled={health.isFetching}
            onClick={() => health.refetch()}
          >
            {health.isFetching ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ArrowClockwiseIcon data-icon="inline-start" />
            )}
            Re-check
          </Button>
        </div>
        {health.isPending ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : health.isError ? (
          <p className="py-2 text-xs text-muted-foreground">
            Couldn't check installed tools.
          </p>
        ) : (
          <ul className="divide-y">
            {health.data?.tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
