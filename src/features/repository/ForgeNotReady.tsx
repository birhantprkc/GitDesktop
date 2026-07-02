import {
  ArrowSquareOutIcon,
  GithubLogoIcon,
  GitlabLogoIcon,
  TerminalIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openInTerminal } from "@/lib/git/api";
import { useForgeStatus, usePublishTargets } from "@/lib/git/queries";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

/**
 * Shared "this hosted feature isn't available" empty state for the Pull
 * Requests, Issues, Discussions, and Actions tabs. Names the actual blocker and
 * pairs it with the one action that resolves it, so the tab is a path forward
 * instead of a dead end. `feature` is the noun the message reads with ("pull
 * requests", "workflow runs").
 *
 * Provider-aware: GitHub walks the gh setup ladder (install → sign in →
 * publish); GitLab walks the analogous glab ladder (until its read ops land);
 * Bitbucket — recognized but not yet implemented — says so plainly.
 */
export function ForgeNotReady({
  repoPath,
  feature,
}: {
  repoPath: string;
  feature: string;
}) {
  const forge = useForgeStatus(repoPath);
  const settings = useSettings();
  const repoName = useUiStore((s) => s.repoName);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishProvider, setPublishProvider] = useState<"github" | "gitlab">(
    "github",
  );

  const provider = forge.data?.provider;
  // A repo with no hosted remote has nothing to detect a provider from, so
  // publish targets are probed explicitly (which CLIs are installed + signed
  // in). This is what lets a glab-only machine publish to GitLab even while the
  // gh ladder below is still asking for the GitHub CLI.
  const installed = Boolean(forge.data?.installed);
  const authed = Boolean(forge.data?.authenticated);
  const targets = usePublishTargets(
    repoPath,
    provider == null && Boolean(forge.data),
  );

  // GitLab: `glab` is wired (status detects install + sign-in), but read
  // operations aren't built yet — walk the glab setup ladder, then say so. (A
  // not-ready GitHub repo has provider `null`, so it skips this and falls through
  // to the gh ladder below, unchanged.)
  if (provider === "gitlab") {
    if (!forge.data?.installed) {
      return (
        <div className="space-y-2.5 px-3 py-4 text-xs text-muted-foreground">
          <p>
            The GitLab CLI (<span className="font-mono">glab</span>) isn't
            installed. GitDesktop will use it to work with {feature} on GitLab.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openUrl("https://gitlab.com/gitlab-org/cli#installation")
            }
            className="cursor-pointer"
          >
            <ArrowSquareOutIcon data-icon="inline-start" />
            Install the GitLab CLI
          </Button>
        </div>
      );
    }
    if (!forge.data?.authenticated) {
      return (
        <div className="space-y-2.5 px-3 py-4 text-xs text-muted-foreground">
          <p>
            Sign in to GitLab to work with {feature}. Run{" "}
            <span className="font-mono text-foreground">glab auth login</span>{" "}
            in a terminal.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openInTerminal(
                repoPath,
                settings.data?.terminal,
                settings.data?.terminalPath,
              ).catch(toastError)
            }
          >
            <TerminalIcon data-icon="inline-start" />
            Open terminal to sign in
          </Button>
        </div>
      );
    }
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        <p>
          GitLab support is on the way — {feature} aren't available here yet.
        </p>
      </div>
    );
  }

  // Bitbucket: recognized, integration not built yet.
  if (provider === "bitbucket") {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        <p>
          This repository is hosted on Bitbucket, which GitDesktop doesn't
          support yet — {feature} are only available for GitHub repositories for
          now.
        </p>
      </div>
    );
  }

  // GitHub: the install → sign-in → publish ladder — plus a GitLab publish
  // path whenever glab is ready (a no-remote repo can go to either provider).
  const glabPublish = targets.data?.gitlab === true;

  return (
    <div className="space-y-2.5 px-3 py-4 text-xs text-muted-foreground">
      {!installed ? (
        <>
          <p>
            The GitHub CLI (<span className="font-mono">gh</span>) isn't
            installed. GitDesktop uses it to work with {feature}.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openUrl("https://cli.github.com")}
            className="cursor-pointer"
          >
            <GithubLogoIcon data-icon="inline-start" />
            Install GitHub CLI
          </Button>
        </>
      ) : !authed ? (
        <>
          <p>
            Sign in to GitHub to work with {feature}. Run{" "}
            <span className="font-mono text-foreground">gh auth login</span> in
            a terminal.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openInTerminal(
                repoPath,
                settings.data?.terminal,
                settings.data?.terminalPath,
              ).catch(toastError)
            }
          >
            <TerminalIcon data-icon="inline-start" />
            Open terminal to sign in
          </Button>
        </>
      ) : (
        <>
          <p>
            This repository isn't published yet. Publish it to use {feature}{" "}
            here.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPublishProvider("github");
              setPublishOpen(true);
            }}
          >
            <UploadSimpleIcon data-icon="inline-start" />
            Publish to GitHub…
          </Button>
        </>
      )}
      {glabPublish && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPublishProvider("gitlab");
            setPublishOpen(true);
          }}
        >
          <GitlabLogoIcon data-icon="inline-start" />
          Publish to GitLab…
        </Button>
      )}
      <PublishDialog
        repoPath={repoPath}
        provider={publishProvider}
        defaultName={repoName ?? ""}
        open={publishOpen}
        onOpenChange={setPublishOpen}
      />
    </div>
  );
}
