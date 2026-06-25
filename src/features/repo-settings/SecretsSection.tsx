import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  useDeleteSecret,
  useDeleteVariable,
  useEnvironments,
  useSecrets,
  useSetSecret,
  useSetVariable,
  useVariables,
} from "@/lib/git/queries";
import type { SecretApp } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const APPS: { value: SecretApp; label: string }[] = [
  { value: "actions", label: "Actions" },
  { value: "dependabot", label: "Dependabot" },
  { value: "codespaces", label: "Codespaces" },
];

const REPO_SCOPE = "$repo";

/** GitHub's rule: letters/digits/underscore, not starting with a digit, and not
 *  starting with GITHUB_. */
function nameError(name: string): string | null {
  if (!name) return null;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use letters, numbers and _, not starting with a number.";
  }
  if (/^github_/i.test(name)) return "Names can't start with GITHUB_.";
  return null;
}

export function SecretsSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const [kind, setKind] = useState<"secrets" | "variables">("secrets");
  const [app, setApp] = useState<SecretApp>("actions");
  const [scope, setScope] = useState<string>(REPO_SCOPE);

  const envs = useEnvironments(repoPath, open);
  // Environment scope exists only for Actions (secrets and variables).
  const envAllowed = kind === "variables" || app === "actions";
  const env = envAllowed && scope !== REPO_SCOPE ? scope : null;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-md border p-0.5">
          {(["secrets", "variables"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1 text-xs capitalize",
                kind === k
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k}
            </button>
          ))}
        </div>

        {kind === "secrets" && (
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Store</Label>
            <Select
              value={app}
              onValueChange={(v) => v && setApp(v as SecretApp)}
            >
              <SelectTrigger size="sm" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Scope</Label>
          <Select
            value={env ?? REPO_SCOPE}
            onValueChange={(v) => v && setScope(v)}
            disabled={!envAllowed}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={REPO_SCOPE}>Repository</SelectItem>
              {(envs.data ?? []).map((e) => (
                <SelectItem key={e} value={e}>
                  <span className="block truncate">{e}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {kind === "secrets" ? (
        <SecretsList repoPath={repoPath} app={app} env={env} open={open} />
      ) : (
        <VariablesList repoPath={repoPath} env={env} open={open} />
      )}
    </div>
  );
}

function SecretsList({
  repoPath,
  app,
  env,
  open,
}: {
  repoPath: string;
  app: SecretApp;
  env: string | null;
  open: boolean;
}) {
  const secrets = useSecrets(repoPath, app, env, open);
  const set = useSetSecret(repoPath);
  const del = useDeleteSecret(repoPath);

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const invalid = nameError(name);
  const canAdd = !!name && !!value && !invalid && !set.isPending;

  function add() {
    set.mutate(
      { app, env, name: name.trim(), value },
      {
        onSuccess: () => {
          toast.success("Secret saved");
          setName("");
          setValue("");
        },
        onError: toastError,
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
          <div className="space-y-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="SECRET_NAME"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {invalid && (
              <p className="text-[11px] text-destructive">{invalid}</p>
            )}
          </div>
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value"
            autoComplete="off"
          />
          <Button size="sm" disabled={!canAdd} onClick={add}>
            {set.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            Add
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Encrypted before it leaves your machine. The value can't be shown
          again — re-enter it to change it.
        </p>
      </div>

      <ListBody
        loading={secrets.isLoading}
        error={secrets.error}
        empty={secrets.data?.length === 0}
        emptyLabel="No secrets here yet."
      >
        {secrets.data?.map((s) => (
          <Row
            key={s.name}
            name={s.name}
            meta={
              s.updatedAt ? `Updated ${formatRelativeTime(s.updatedAt)}` : ""
            }
            confirming={confirming === s.name}
            pending={del.isPending}
            onConfirm={() => setConfirming(s.name)}
            onCancel={() => setConfirming(null)}
            onDelete={() =>
              del.mutate(
                { app, env, name: s.name },
                {
                  onSuccess: () => {
                    toast.success("Secret removed");
                    setConfirming(null);
                  },
                  onError: toastError,
                },
              )
            }
          />
        ))}
      </ListBody>
    </div>
  );
}

function VariablesList({
  repoPath,
  env,
  open,
}: {
  repoPath: string;
  env: string | null;
  open: boolean;
}) {
  const variables = useVariables(repoPath, env, open);
  const set = useSetVariable(repoPath);
  const del = useDeleteVariable(repoPath);

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const invalid = nameError(name);
  const canAdd = !!name && !invalid && !set.isPending;

  function add() {
    set.mutate(
      { env, name: name.trim(), value },
      {
        onSuccess: () => {
          toast.success("Variable saved");
          setName("");
          setValue("");
        },
        onError: toastError,
      },
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border p-3">
        <div className="grid grid-cols-[1fr_1fr_auto] items-start gap-2">
          <div className="space-y-1">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VARIABLE_NAME"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            {invalid && (
              <p className="text-[11px] text-destructive">{invalid}</p>
            )}
          </div>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value"
            autoComplete="off"
          />
          <Button size="sm" disabled={!canAdd} onClick={add}>
            {set.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Reusing an existing name updates that variable.
        </p>
      </div>

      <ListBody
        loading={variables.isLoading}
        error={variables.error}
        empty={variables.data?.length === 0}
        emptyLabel="No variables here yet."
      >
        {variables.data?.map((v) => (
          <Row
            key={v.name}
            name={v.name}
            meta={v.value}
            metaMono
            confirming={confirming === v.name}
            pending={del.isPending}
            onConfirm={() => setConfirming(v.name)}
            onCancel={() => setConfirming(null)}
            onEdit={() => {
              setName(v.name);
              setValue(v.value);
            }}
            onDelete={() =>
              del.mutate(
                { env, name: v.name },
                {
                  onSuccess: () => {
                    toast.success("Variable removed");
                    setConfirming(null);
                  },
                  onError: toastError,
                },
              )
            }
          />
        ))}
      </ListBody>
    </div>
  );
}

function ListBody({
  loading,
  error,
  empty,
  emptyLabel,
  children,
}: {
  loading: boolean;
  error: unknown;
  empty: boolean;
  emptyLabel: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
        <p className="font-medium text-destructive">Couldn't load these.</p>
        <p className="mt-1 text-muted-foreground">
          {error instanceof Error ? error.message : null}
        </p>
        <p className="mt-2 text-muted-foreground">
          If this is a permissions error, your GitHub sign-in may need a broader
          scope — run{" "}
          <span className="font-mono">
            gh auth refresh -h github.com -s repo
          </span>{" "}
          and reopen this dialog.
        </p>
      </div>
    );
  }
  if (empty) {
    return (
      <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return <div className="space-y-2">{children}</div>;
}

function Row({
  name,
  meta,
  metaMono,
  confirming,
  pending,
  onConfirm,
  onCancel,
  onDelete,
  onEdit,
}: {
  name: string;
  meta: string;
  metaMono?: boolean;
  confirming: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border p-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono font-medium">{name}</p>
        {meta && (
          <p
            className={cn(
              "truncate text-muted-foreground",
              metaMono && "font-mono",
            )}
          >
            {meta}
          </p>
        )}
      </div>
      {confirming ? (
        <>
          <span className="text-muted-foreground">Delete?</span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={onDelete}
          >
            {pending && <Spinner data-icon="inline-start" />}
            Delete
          </Button>
        </>
      ) : (
        <>
          {onEdit && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onConfirm}
          >
            <TrashIcon />
          </Button>
        </>
      )}
    </div>
  );
}
