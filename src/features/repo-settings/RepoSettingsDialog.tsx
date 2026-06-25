import {
  ArrowClockwiseIcon,
  BroadcastIcon,
  CaretLeftIcon,
  ClockCounterClockwiseIcon,
  CopyIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { highlightJson } from "@/features/diff/shiki-highlighter";
import { copyText } from "@/lib/clipboard";
import {
  useCreateWebhook,
  useDeleteWebhook,
  usePingWebhook,
  useRedeliverWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhookDelivery,
  useWebhooks,
} from "@/lib/git/queries";
import type { HookDelivery, Webhook, WebhookInput } from "@/lib/git/types";
import { formatRelativeTime } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { CollaboratorsSection } from "./CollaboratorsSection";
import { FundingSection } from "./FundingSection";
import { GeneralSettingsSection } from "./GeneralSettingsSection";
import { SecretsSection } from "./SecretsSection";

// A curated set of the events people wire webhooks to, plus the "everything"
// option. Not GitHub's full ~30 — the long tail can be added later.
const COMMON_EVENTS: { id: string; label: string }[] = [
  { id: "push", label: "Push" },
  { id: "pull_request", label: "Pull requests" },
  { id: "pull_request_review", label: "PR reviews" },
  { id: "issues", label: "Issues" },
  { id: "issue_comment", label: "Issue comments" },
  { id: "release", label: "Releases" },
  { id: "create", label: "Branch/tag created" },
  { id: "delete", label: "Branch/tag deleted" },
  { id: "fork", label: "Forks" },
  { id: "workflow_run", label: "Workflow runs" },
  { id: "deployment", label: "Deployments" },
  { id: "discussion", label: "Discussions" },
];

function eventsSummary(events: string[]): string {
  if (events.includes("*")) return "All events";
  if (events.length === 0) return "No events";
  const labels = events.map(
    (e) => COMMON_EVENTS.find((c) => c.id === e)?.label ?? e,
  );
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3}`;
}

export function RepoSettingsDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* flex + max-h caps the dialog to the viewport; the active tab body
          scrolls (overflow-y-auto) so many webhooks / the long form don't push
          it off-screen. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Repository settings</DialogTitle>
          <DialogDescription>
            Manage this GitHub repository's settings and webhooks. Changes apply
            on GitHub immediately.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex min-h-0 min-w-0 flex-col">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="access">Access</TabsTrigger>
            <TabsTrigger value="sponsor">Sponsor</TabsTrigger>
            <TabsTrigger value="secrets">Secrets &amp; variables</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>
          <TabsContent
            value="general"
            className="min-h-0 min-w-0 overflow-y-auto pr-1"
          >
            <GeneralSettingsSection repoPath={repoPath} open={open} />
          </TabsContent>
          <TabsContent
            value="access"
            className="min-h-0 min-w-0 overflow-y-auto pr-1"
          >
            <CollaboratorsSection repoPath={repoPath} open={open} />
          </TabsContent>
          <TabsContent
            value="sponsor"
            className="min-h-0 min-w-0 overflow-y-auto pr-1"
          >
            <FundingSection repoPath={repoPath} open={open} />
          </TabsContent>
          <TabsContent
            value="secrets"
            className="min-h-0 min-w-0 overflow-y-auto pr-1"
          >
            <SecretsSection repoPath={repoPath} open={open} />
          </TabsContent>
          <TabsContent
            value="webhooks"
            className="min-h-0 min-w-0 overflow-y-auto pr-1"
          >
            <WebhooksSection repoPath={repoPath} open={open} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function WebhooksSection({
  repoPath,
  open,
}: {
  repoPath: string;
  open: boolean;
}) {
  const hooks = useWebhooks(repoPath, open);
  // null = list view; a Webhook = editing it; "new" = the create form.
  const [editing, setEditing] = useState<Webhook | "new" | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Webhook | null>(null);

  if (deliveriesFor) {
    return (
      <DeliveriesView
        repoPath={repoPath}
        hook={deliveriesFor}
        onBack={() => setDeliveriesFor(null)}
      />
    );
  }

  if (editing) {
    return (
      <WebhookForm
        repoPath={repoPath}
        hook={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
  }

  return (
    // min-w-0: DialogContent is display:grid, so this grid item must be allowed
    // to shrink below its content (the long webhook URL) for truncate to work.
    <div className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {hooks.data?.length
            ? `${hooks.data.length} webhook${hooks.data.length === 1 ? "" : "s"}`
            : "Send a POST to a URL when events happen in this repo."}
        </p>
        <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          Add webhook
        </Button>
      </div>

      {hooks.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {hooks.isError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
          <p className="font-medium text-destructive">
            Couldn't load webhooks.
          </p>
          <p className="mt-1 text-muted-foreground">
            {hooks.error instanceof Error ? hooks.error.message : null}
          </p>
          <p className="mt-2 text-muted-foreground">
            If this is a permissions error, your GitHub sign-in may be missing
            the <span className="font-mono">admin:repo_hook</span> scope. Run{" "}
            <span className="font-mono">
              gh auth refresh -h github.com -s admin:repo_hook
            </span>{" "}
            in a terminal, then reopen this dialog.
          </p>
        </div>
      )}

      {hooks.data?.length === 0 && (
        <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
          No webhooks yet.
        </p>
      )}

      {hooks.data?.map((hook) => (
        <WebhookRow
          key={hook.id}
          repoPath={repoPath}
          hook={hook}
          onEdit={() => setEditing(hook)}
          onDeliveries={() => setDeliveriesFor(hook)}
        />
      ))}
    </div>
  );
}

function WebhookRow({
  repoPath,
  hook,
  onEdit,
  onDeliveries,
}: {
  repoPath: string;
  hook: Webhook;
  onEdit: () => void;
  onDeliveries: () => void;
}) {
  const ping = usePingWebhook(repoPath);
  const test = useTestWebhook(repoPath);
  const del = useDeleteWebhook(repoPath);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const lastCode = hook.lastResponse.code;
  const lastTone =
    lastCode == null
      ? "text-muted-foreground"
      : lastCode >= 200 && lastCode < 300
        ? "text-green-600 dark:text-green-400"
        : "text-red-600 dark:text-red-400";
  const canTest = hook.events.includes("push") || hook.events.includes("*");

  return (
    <div className="rounded-md border p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className="min-w-0 flex-1 truncate font-mono"
              title={hook.config.url}
            >
              {hook.config.url}
            </p>
            <button
              type="button"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              title="Copy URL"
              onClick={() => copyText(hook.config.url, "Webhook URL copied")}
            >
              <CopyIcon className="size-3.5" />
            </button>
          </div>
          <p className="mt-1 text-muted-foreground">
            {eventsSummary(hook.events)} ·{" "}
            <span className={lastTone}>
              {lastCode == null
                ? "not yet delivered"
                : `last: ${lastCode} ${hook.lastResponse.status}`}
            </span>
          </p>
        </div>
        <Badge variant={hook.active ? "default" : "secondary"}>
          {hook.active ? "Active" : "Inactive"}
        </Badge>
      </div>

      <div className="mt-2 flex items-center justify-end gap-1">
        {confirmingDelete ? (
          <>
            <span className="mr-auto text-muted-foreground">
              Remove this webhook?
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(hook.id, {
                  onSuccess: () => toast.success("Webhook removed"),
                  onError: toastError,
                })
              }
            >
              {del.isPending && <Spinner data-icon="inline-start" />}
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={ping.isPending}
              title="Send a ping event"
              onClick={() =>
                ping.mutate(hook.id, {
                  onSuccess: () => toast.success("Ping sent"),
                  onError: toastError,
                })
              }
            >
              <BroadcastIcon data-icon="inline-start" />
              Ping
            </Button>
            {canTest && (
              <Button
                size="sm"
                variant="ghost"
                disabled={test.isPending}
                title="Trigger a test push event"
                onClick={() =>
                  test.mutate(hook.id, {
                    onSuccess: () => toast.success("Test event sent"),
                    onError: toastError,
                  })
                }
              >
                <ArrowClockwiseIcon data-icon="inline-start" />
                Test
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              title="Recent deliveries"
              onClick={onDeliveries}
            >
              <ClockCounterClockwiseIcon data-icon="inline-start" />
              Deliveries
            </Button>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <PencilSimpleIcon data-icon="inline-start" />
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              <TrashIcon data-icon="inline-start" />
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DeliveriesView({
  repoPath,
  hook,
  onBack,
}: {
  repoPath: string;
  hook: Webhook;
  onBack: () => void;
}) {
  const deliveries = useWebhookDeliveries(repoPath, hook.id, true);

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <CaretLeftIcon />
          Back
        </button>
        <p
          className="min-w-0 flex-1 truncate text-right font-mono text-[11px] text-muted-foreground"
          title={hook.config.url}
        >
          {hook.config.url}
        </p>
      </div>

      {deliveries.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {deliveries.isError && (
        <p className="text-xs text-destructive">
          {deliveries.error instanceof Error
            ? deliveries.error.message
            : "Couldn't load deliveries."}
        </p>
      )}
      {deliveries.data?.length === 0 && (
        <p className="rounded-md border border-dashed py-8 text-center text-xs text-muted-foreground">
          No deliveries yet.
        </p>
      )}

      <div className="space-y-2">
        {deliveries.data?.map((d) => (
          <DeliveryRow
            key={d.id}
            repoPath={repoPath}
            hookId={hook.id}
            delivery={d}
          />
        ))}
      </div>
    </div>
  );
}

function DeliveryRow({
  repoPath,
  hookId,
  delivery,
}: {
  repoPath: string;
  hookId: number;
  delivery: HookDelivery;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = useWebhookDelivery(
    repoPath,
    hookId,
    expanded ? delivery.id : null,
  );
  const redeliver = useRedeliverWebhook(repoPath, hookId);

  const ok = delivery.statusCode >= 200 && delivery.statusCode < 300;
  const eventLabel = delivery.action
    ? `${delivery.event}.${delivery.action}`
    : delivery.event;

  return (
    <div className="rounded-md border text-xs">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/40"
      >
        <span
          className={cn(
            "shrink-0 font-mono tabular-nums",
            ok
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400",
          )}
        >
          {delivery.statusCode || "—"}
        </span>
        <span className="truncate font-medium">{eventLabel}</span>
        {delivery.redelivery && (
          <Badge variant="secondary" className="shrink-0">
            redelivered
          </Badge>
        )}
        <span className="ml-auto shrink-0 text-muted-foreground">
          {delivery.deliveredAt ? formatRelativeTime(delivery.deliveredAt) : ""}
        </span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t p-2">
          <div className="flex justify-end">
            <Button
              size="xs"
              variant="ghost"
              disabled={redeliver.isPending}
              onClick={() =>
                redeliver.mutate(delivery.id, {
                  onSuccess: () => toast.success("Redelivery queued"),
                  onError: toastError,
                })
              }
            >
              {redeliver.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ArrowClockwiseIcon data-icon="inline-start" />
              )}
              Redeliver
            </Button>
          </div>
          {detail.isLoading && <Skeleton className="h-16 w-full" />}
          {detail.isError && (
            <p className="text-[11px] text-destructive">
              {detail.error instanceof Error
                ? detail.error.message
                : "Couldn't load the payload."}
            </p>
          )}
          {detail.data && (
            <>
              <DeliveryPayload
                label="Request payload"
                body={detail.data.requestPayload}
              />
              <DeliveryPayload
                label="Response body"
                body={detail.data.responsePayload}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeliveryPayload({ label, body }: { label: string; body: string }) {
  const trimmed = body.trim();
  // Highlight as JSON when it looks like JSON and isn't huge (tokenizing a big
  // blob would block); otherwise render it plain.
  const lines = useMemo(
    () =>
      trimmed.length > 0 &&
      trimmed.length < 50_000 &&
      (trimmed.startsWith("{") || trimmed.startsWith("["))
        ? highlightJson(body)
        : null,
    [body, trimmed],
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        {trimmed.length > 0 && (
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            title={`Copy ${label.toLowerCase()}`}
            onClick={() => copyText(body, `${label} copied`)}
          >
            <CopyIcon className="size-3.5" />
          </button>
        )}
      </div>
      {trimmed.length > 0 ? (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2 font-mono text-[11px]">
          {lines
            ? lines.map((line, i) => (
                <Fragment key={i}>
                  {i > 0 && "\n"}
                  {line.map((t, j) => (
                    <span
                      key={j}
                      style={t.color ? { color: t.color } : undefined}
                    >
                      {t.content}
                    </span>
                  ))}
                </Fragment>
              ))
            : body}
        </pre>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">(empty)</p>
      )}
    </div>
  );
}

function WebhookForm({
  repoPath,
  hook,
  onDone,
}: {
  repoPath: string;
  hook: Webhook | null;
  onDone: () => void;
}) {
  const create = useCreateWebhook(repoPath);
  const update = useUpdateWebhook(repoPath);
  const pending = create.isPending || update.isPending;

  const [url, setUrl] = useState(hook?.config.url ?? "");
  const [contentType, setContentType] = useState<"json" | "form">(
    hook?.config.contentType === "form" ? "form" : "json",
  );
  const [secret, setSecret] = useState("");
  const [verifySsl, setVerifySsl] = useState(
    hook ? hook.config.insecureSsl !== "1" : true,
  );
  const [allEvents, setAllEvents] = useState(
    hook ? hook.events.includes("*") : false,
  );
  const [events, setEvents] = useState<Set<string>>(
    new Set(hook ? hook.events.filter((e) => e !== "*") : ["push"]),
  );
  const [active, setActive] = useState(hook?.active ?? true);

  const hadSecret = hook?.config.secret != null;
  const urlValid = /^https?:\/\/.+/.test(url.trim());
  const eventsValid = allEvents || events.size > 0;

  function toggleEvent(id: string, on: boolean) {
    setEvents((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function submit() {
    const input: WebhookInput = {
      url: url.trim(),
      contentType,
      secret: secret.trim() || null,
      insecureSsl: !verifySsl,
      events: allEvents ? ["*"] : [...events],
      active,
    };
    const opts = {
      onSuccess: () => {
        toast.success(hook ? "Webhook updated" : "Webhook created");
        onDone();
      },
      onError: toastError,
    };
    if (hook) update.mutate({ id: hook.id, input }, opts);
    else create.mutate(input, opts);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="hook-url">Payload URL</Label>
        <Input
          id="hook-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="hook-content-type">Content type</Label>
          <Select
            value={contentType}
            onValueChange={(v) => setContentType(v as "json" | "form")}
          >
            <SelectTrigger id="hook-content-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">application/json</SelectItem>
              <SelectItem value="form">
                application/x-www-form-urlencoded
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hook-secret">Secret</Label>
          <Input
            id="hook-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={hadSecret ? "•••••••• (set)" : "Optional"}
            autoComplete="off"
          />
          {hadSecret && (
            <p className="text-[11px] text-muted-foreground">
              Leave blank to keep the current secret.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Events</Label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch checked={allEvents} onCheckedChange={setAllEvents} />
          Send me everything
        </label>
        {!allEvents && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 sm:grid-cols-3">
            {COMMON_EVENTS.map((ev) => (
              <label
                key={ev.id}
                className="flex cursor-pointer items-center gap-2 text-xs"
              >
                <Checkbox
                  checked={events.has(ev.id)}
                  onCheckedChange={(c) => toggleEvent(ev.id, c === true)}
                />
                {ev.label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch checked={verifySsl} onCheckedChange={setVerifySsl} />
          Verify SSL certificate
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Switch checked={active} onCheckedChange={setActive} />
          Active
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          disabled={pending || !urlValid || !eventsValid}
          onClick={submit}
          className={cn(!urlValid || !eventsValid ? "cursor-not-allowed" : "")}
          title={
            !urlValid
              ? "Enter a valid http(s) URL"
              : !eventsValid
                ? "Select at least one event"
                : undefined
          }
        >
          {pending && <Spinner data-icon="inline-start" />}
          {hook ? "Save changes" : "Create webhook"}
        </Button>
      </div>
    </div>
  );
}
