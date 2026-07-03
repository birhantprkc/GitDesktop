import {
  ArrowSquareOutIcon,
  GearSixIcon,
  GithubLogoIcon,
  GitlabLogoIcon,
  TerminalIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openInTerminal } from "@/lib/git/api";
import {
  useForgeStatus,
  usePublishTargets,
  useRemotes,
} from "@/lib/git/queries";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PublishDialog } from "./PublishDialog";

/** Where a Bitbucket / Atlassian API token is created. */
const ATLASSIAN_TOKEN_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

/**
 * Shared "this hosted feature isn't available" empty state for the Pull
 * Requests, Issues, Discussions, and Actions tabs. Names the actual blocker and
 * pairs it with the one action that resolves it, so the tab is a path forward
 * instead of a dead end. `feature` is the noun the message reads with ("pull
 * requests", "workflow runs").
 *
 * Provider-aware: GitHub walks the gh setup ladder (install → sign in →
 * publish); GitLab walks the analogous glab ladder (install → sign in), then —
 * if glab is ready but the repo still isn't resolvable to a GitLab project —
 * points at `glab auth status`; Bitbucket — recognized but not yet implemented
 * — says so plainly.
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
  const openSettings = useUiStore((s) => s.openSettings);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishProvider, setPublishProvider] = useState<"github" | "gitlab">(
    "github",
  );

  const provider = forge.data?.provider;
  // A repo with no hosted remote has nothing to detect a provider from, so
  // publish targets are probed explicitly (which CLIs are installed + signed
  // in). This is what lets a glab-only machine publish to GitLab even while the
  // gh ladder below is still asking for the GitHub CLI. Gated on the repo
  // actually having NO origin: provider is ALSO null for repos whose remote gh
  // simply can't identify (gh signed out, an unrecognized host) — publishing
  // those would create an orphan project and then fail adding `origin`.
  const installed = Boolean(forge.data?.installed);
  const authed = Boolean(forge.data?.authenticated);
  const remotes = useRemotes(repoPath);
  const noOrigin = remotes.isSuccess && !remotes.data.includes("origin");
  const targets = usePublishTargets(
    repoPath,
    provider == null && Boolean(forge.data) && noOrigin,
  );

  // GitLab: `glab` is wired (status detects install + sign-in) — walk the glab
  // setup ladder (install → sign in). If glab is already ready, this repo just
  // couldn't be resolved to a GitLab project; point at `glab auth status`. (A
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
          GitDesktop couldn't connect this repository to GitLab, so {feature}{" "}
          aren't available here. Run{" "}
          <span className="font-mono text-foreground">glab auth status</span> in
          a terminal to check the host's connection.
        </p>
      </div>
    );
  }

  // Bitbucket: read integration via an Atlassian API token. Walk the connect
  // ladder — no token saved → connect; a saved token that won't authenticate →
  // update it. Both deep-link to Settings → Accounts in one atomic navigation.
  if (provider === "bitbucket") {
    return (
      <div className="space-y-2.5 px-3 py-4 text-xs text-muted-foreground">
        {!installed ? (
          <p>
            Connect your Bitbucket account with an Atlassian API token to see{" "}
            {feature} here.
          </p>
        ) : (
          <p>
            GitDesktop couldn't sign in to Bitbucket with the saved token — it
            may be expired, revoked, or missing scopes. Update it in Settings →
            Accounts.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openSettings("accounts")}
          >
            <GearSixIcon data-icon="inline-start" />
            Open Settings → Accounts
          </Button>
          {!installed && (
            <Button
              variant="ghost"
              size="sm"
              className="cursor-pointer"
              onClick={() => openUrl(ATLASSIAN_TOKEN_URL)}
            >
              <ArrowSquareOutIcon data-icon="inline-start" />
              Create an API token
            </Button>
          )}
        </div>
      </div>
    );
  }

  // GitHub: the install → sign-in → publish ladder — plus a GitLab publish
  // path whenever glab is ready (a no-remote repo can go to either provider).
  const glabPublish = noOrigin && targets.data?.gitlab === true;

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
