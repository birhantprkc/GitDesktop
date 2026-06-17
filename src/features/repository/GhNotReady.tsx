import {
  GithubLogoIcon,
  TerminalIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openInTerminal } from "@/lib/git/api";
import { useGhStatus } from "@/lib/git/queries";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

/**
 * Shared "this needs GitHub" empty state for the Pull Requests and Actions
 * tabs. Names the actual blocker — gh missing, signed out, or the repo simply
 * not on GitHub — and pairs each with the one action that resolves it, so the
 * tab is a path forward instead of a dead end. `feature` is the noun the
 * message reads with ("pull requests", "workflow runs").
 */
export function GhNotReady({
  repoPath,
  feature,
}: {
  repoPath: string;
  feature: string;
}) {
  const gh = useGhStatus(repoPath);
  const settings = useSettings();
  const repoName = useUiStore((s) => s.repoName);
  const [publishOpen, setPublishOpen] = useState(false);

  const installed = Boolean(gh.data?.installed);
  const authed = Boolean(gh.data?.authenticated);

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
