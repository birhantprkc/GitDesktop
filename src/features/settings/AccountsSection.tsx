import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import { useAppForm } from "@/lib/form";
import { forgeBbClearAccount, forgeBbSetAccount } from "@/lib/git/api";
import {
  useBbAccount,
  useGhAccounts,
  useSwitchAccount,
} from "@/lib/git/queries";
import type { GhAccount } from "@/lib/git/types";
import { errorMessage } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";

/** Where a Bitbucket / Atlassian API token is created. */
const ATLASSIAN_TOKEN_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

/** The scopes a token needs for full Bitbucket support: the five read scopes that
 *  power browsing/PR/Pipeline reads, plus the two write scopes for acting on PRs
 *  and Pipelines. Writes fail with a clear message if the token lacks the latter. */
const BB_SCOPES = [
  "read:user:bitbucket",
  "read:workspace:bitbucket",
  "read:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "read:pipeline:bitbucket",
  "write:pullrequest:bitbucket",
  "write:pipeline:bitbucket",
];

/** Whether this gh supports multiple accounts (`gh auth switch`, 2.40+). */
function supportsSwitching(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 40);
}

/**
 * Sign-in settings for the hosted providers: the GitHub CLI accounts (switch the
 * active account per host) and a Bitbucket Cloud account (an Atlassian API token
 * in the OS keychain). GitLab is CLI-driven like GitHub (via `glab auth login`),
 * so it has no block here.
 */
export function AccountsSection() {
  return (
    <div className="space-y-8">
      <GitHubAccounts />
      <BitbucketAccount />
    </div>
  );
}

/**
 * GitHub accounts known to the gh CLI. Switching changes which account
 * every GitHub feature acts as — immediately, like API keys.
 */
function GitHubAccounts() {
  const accounts = useGhAccounts();
  const switchAccount = useSwitchAccount();

  const version = accounts.data?.version ?? "";
  const canSwitch = supportsSwitching(version);
  const list = accounts.data?.accounts ?? [];

  // Group accounts by host so a developer with both github.com and an
  // Enterprise account sees the active one per host. github.com first, then
  // alphabetical. A single-host user (today's common case) gets no subhead.
  const groups = useMemo(() => {
    const byHost = new Map<string, GhAccount[]>();
    for (const account of list) {
      const arr = byHost.get(account.host) ?? [];
      arr.push(account);
      byHost.set(account.host, arr);
    }
    return [...byHost.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === "github.com") return -1;
      if (b === "github.com") return 1;
      return a.localeCompare(b);
    });
  }, [list]);
  const multiHost = groups.length > 1;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">GitHub</h2>
        <p className="text-xs text-muted-foreground">
          GitDesktop acts as whichever account is active in the GitHub CLI —
          pull requests, issues, and pushes all use it. Works with github.com
          and GitHub Enterprise hosts alike. (GitLab signs in the same way, via{" "}
          <span className="font-mono">glab auth login</span>.)
        </p>
      </div>

      {accounts.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : version === "" ? (
        <p className="text-xs text-muted-foreground">
          The GitHub CLI (gh) isn't installed, so there are no accounts to
          manage.
        </p>
      ) : (
        <>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No account is signed in yet.
            </p>
          ) : (
            <div className="max-w-xl space-y-4">
              {groups.map(([host, hostAccounts]) => (
                <div key={host} className="space-y-1.5">
                  {multiHost && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {host}
                    </p>
                  )}
                  <div className="space-y-px border">
                    {hostAccounts.map((account) => (
                      <div
                        key={`${account.host}/${account.login}`}
                        className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                      >
                        <span className="text-xs font-medium">
                          {account.login}
                        </span>
                        {account.active && (
                          <Badge variant="secondary">active</Badge>
                        )}
                        <span className="flex-1" />
                        {!account.active && (
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={!canSwitch || switchAccount.isPending}
                            title={
                              canSwitch
                                ? `Make ${account.login} the active account on ${account.host}`
                                : "Switching needs GitHub CLI 2.40 or newer"
                            }
                            onClick={() =>
                              switchAccount.mutate(
                                { host: account.host, login: account.login },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      `Switched to ${account.login}`,
                                    ),
                                  onError: (e) => toastError(e),
                                },
                              )
                            }
                          >
                            {switchAccount.isPending && (
                              <Spinner data-icon="inline-start" />
                            )}
                            Switch
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canSwitch && (
            <p className="text-xs text-warning">
              Multiple accounts need GitHub CLI 2.40+ (you have {version}).
              Update with{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() =>
                  copyText("winget upgrade GitHub.cli", "Command copied")
                }
                title="Copy command"
              >
                winget upgrade GitHub.cli
              </button>
              , then restart GitDesktop.
            </p>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium">Add an account</p>
            <p className="text-xs text-muted-foreground">
              gh's sign-in flow is interactive — run{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() => copyText("gh auth login", "Command copied")}
                title="Copy command"
              >
                gh auth login
              </button>{" "}
              in a terminal, then come back here.
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * A Bitbucket Cloud account, connected with an Atlassian API token. Immediate-
 * apply like the AI-provider keys (the token isn't part of the settings draft):
 * connecting validates the token against Bitbucket, saves it to the OS keychain,
 * and flips open Bitbucket repos ready without a restart.
 */
function BitbucketAccount() {
  const account = useBbAccount();
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = account.data ?? null;

  // The set/clear both invalidate the account query AND every repo's forge-status
  // so a connected Bitbucket repo lights up (or goes dark) without a restart.
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["bb-account"] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "repo" && q.queryKey[2] === "forge-status",
    });
  }

  const form = useAppForm({
    defaultValues: { email: connected?.email ?? "", token: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const info = await forgeBbSetAccount(
          value.email.trim(),
          value.token.trim(),
        );
        form.reset({ email: info.email, token: "" });
        setReplacing(false);
        invalidateAll();
        toast.success(
          `Connected to Bitbucket as ${info.username ?? info.email}`,
        );
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });

  const email = useSelector(form.store, (s) => s.values.email);
  const token = useSelector(form.store, (s) => s.values.token);
  const canSubmit = email.trim().length > 0 && token.trim().length > 0;
  const disabledReason =
    email.trim().length === 0
      ? "Enter your Atlassian account email"
      : token.trim().length === 0
        ? "Paste an Atlassian API token"
        : null;

  async function clearAccount() {
    try {
      await forgeBbClearAccount();
      setConfirmClear(false);
      setReplacing(false);
      form.reset({ email: "", token: "" });
      invalidateAll();
      toast.success("Disconnected from Bitbucket");
    } catch (e) {
      toastError(e);
    }
  }

  const showForm = !connected || replacing;

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">Bitbucket</h2>
        <p className="text-xs text-muted-foreground">
          Connect Bitbucket Cloud with an Atlassian API token to browse and
          clone your repositories and read pull requests and Pipelines. Tokens
          are stored in the OS keychain, never in app files.
        </p>
      </div>

      {account.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="max-w-xl space-y-4">
          {connected && !replacing && (
            <div className="space-y-3 border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                  <p
                    className="truncate text-xs font-medium"
                    title={connected.username ?? connected.email}
                  >
                    {connected.displayName ??
                      connected.username ??
                      connected.email}
                  </p>
                  <p
                    className="truncate text-[11px] text-muted-foreground"
                    title={connected.email}
                  >
                    {connected.username ? `${connected.username} · ` : ""}
                    {connected.email}
                  </p>
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0">
                  connected
                </Badge>
              </div>
              <div className="flex items-center gap-2 px-3 pb-3">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setError(null);
                    form.reset({ email: connected.email, token: "" });
                    setReplacing(true);
                  }}
                >
                  Replace token…
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirmClear(true)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          )}

          {showForm && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <form.AppField name="email">
                {(field) => (
                  <field.TextField
                    type="email"
                    label="Atlassian account email"
                    placeholder="you@example.com"
                  />
                )}
              </form.AppField>
              <form.AppField name="token">
                {(field) => (
                  <field.TextField
                    type="password"
                    label="API token"
                    placeholder="Paste your Atlassian API token"
                  />
                )}
              </form.AppField>

              <div className="flex items-center gap-2">
                {/* A natively-disabled button swallows its title tooltip, so wrap
                    it in a span that carries the reason. */}
                <span title={disabledReason ?? undefined}>
                  <Button type="submit" size="sm" disabled={!canSubmit}>
                    {connected ? "Save token" : "Connect"}
                  </Button>
                </span>
                {replacing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplacing(false);
                      setError(null);
                    }}
                  >
                    Cancel
                  </Button>
                )}
                {disabledReason && (
                  <span className="text-xs text-warning">{disabledReason}</span>
                )}
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          )}

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              Create a token at{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2"
                onClick={() => openUrl(ATLASSIAN_TOKEN_URL)}
                title="Open the Atlassian API tokens page"
              >
                id.atlassian.com
              </button>{" "}
              and sign in with your Atlassian{" "}
              <span className="font-medium">account email</span> (not your
              Bitbucket username). The token needs these scopes (the{" "}
              <span className="font-mono">write:…</span> scopes let you act on PRs
              and Pipelines):
            </p>
            <ul className="flex flex-wrap gap-1">
              {BB_SCOPES.map((scope) => (
                <li
                  key={scope}
                  className="rounded-none border px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {scope}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Bitbucket?</DialogTitle>
            <DialogDescription>
              Removes the saved Atlassian API token from the OS keychain.
              Bitbucket repositories will stop loading their pull requests and
              Pipelines until you connect again. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clearAccount}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
