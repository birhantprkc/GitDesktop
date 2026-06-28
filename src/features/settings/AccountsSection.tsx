import { useMemo } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import { useGhAccounts, useSwitchAccount } from "@/lib/git/queries";
import type { GhAccount } from "@/lib/git/types";
import { toastError } from "@/lib/toast";

/** Whether this gh supports multiple accounts (`gh auth switch`, 2.40+). */
function supportsSwitching(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 40);
}

/**
 * GitHub accounts known to the gh CLI. Switching changes which account
 * every GitHub feature acts as — immediately, like API keys.
 */
export function AccountsSection() {
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
        <h2 className="text-sm font-medium">GitHub accounts</h2>
        <p className="text-xs text-muted-foreground">
          GitDesktop acts as whichever account is active in the GitHub CLI —
          pull requests, issues, and pushes all use it. Works with github.com
          and GitHub Enterprise hosts alike.
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
