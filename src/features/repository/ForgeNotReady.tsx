import {
  GithubLogoIcon,
  TerminalIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openInTerminal } from "@/lib/git/api";
import { useForgeStatus } from "@/lib/git/queries";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

/** Display name for a recognized host whose integration isn't built yet. */
const UNSUPPORTED_PROVIDER: Record<string, string> = {
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

/**
 * Shared "this hosted feature isn't available" empty state for the Pull
 * Requests, Issues, Discussions, and Actions tabs. Names the actual blocker and
 * pairs it with the one action that resolves it, so the tab is a path forward
 * instead of a dead end. `feature` is the noun the message reads with ("pull
 * requests", "workflow runs").
 *
 * Provider-aware: for a GitHub repo it walks the gh setup ladder (install →
 * sign in → publish); for a repo on a host GitDesktop doesn't support yet
 * (GitLab/Bitbucket) it says so plainly.
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

  const provider = forge.data?.provider;

  // A repo on a recognized host whose provider isn't implemented yet. (A
  // not-ready GitHub repo has provider `null` — no repo recognized — so it
  // falls through to the gh ladder below, unchanged.)
  if (provider === "gitlab" || provider === "bitbucket") {
    return (
      <div className="px-3 py-4 text-xs text-muted-foreground">
        <p>
          This repository is hosted on {UNSUPPORTED_PROVIDER[provider]}, which
          GitDesktop doesn't support yet — {feature} are only available for
          GitHub repositories for now.
        </p>
      </div>
    );
  }

  // GitHub: the install → sign-in → publish ladder.
  const installed = Boolean(forge.data?.installed);
  const authed = Boolean(forge.data?.authenticated);

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
            This repository isn't on GitHub yet. Publish it to use {feature}{" "}
            here.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPublishOpen(true)}
          >
            <UploadSimpleIcon data-icon="inline-start" />
            Publish to GitHub…
          </Button>
          <PublishDialog
            repoPath={repoPath}
            defaultName={repoName ?? ""}
            open={publishOpen}
            onOpenChange={setPublishOpen}
          />
        </>
      )}
    </div>
  );
}
