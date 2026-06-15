import { CheckCircleIcon, CopyIcon, XCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Spinner } from "@/components/ui/spinner";
import { detectAgentCli, providerKind } from "@/lib/ai/agent";
import { createAiClient } from "@/lib/ai/client";
import { useAvailableModels } from "@/lib/ai/models";
import {
  ALL_PROVIDER_IDS,
  GENERATION_PROVIDER_IDS,
  isCliProvider,
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  PROVIDERS_REQUIRING_KEY,
} from "@/lib/ai/providers";
import type { AiProviderId, AiSettings } from "@/lib/ai/types";
import { required, useAppForm, withForm } from "@/lib/form";
import { deleteSecret, setSecret } from "@/lib/git/api";
import { settingsKeys, useSecretPreview } from "@/lib/settings/queries";
import { errorMessage } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";
import { settingsFormOpts } from "./settings-form";

/** Typical key shapes per provider; used for a soft warning, never to block. */
const KEY_HINTS: Partial<
  Record<AiProviderId, { prefix: string; minLength: number }>
> = {
  openai: { prefix: "sk-", minLength: 40 },
  anthropic: { prefix: "sk-ant-", minLength: 40 },
  openrouter: { prefix: "sk-or-", minLength: 40 },
};

function keyShapeWarning(provider: AiProviderId, value: string): string | null {
  const hint = KEY_HINTS[provider];
  if (!hint || !value.trim()) return null;
  const v = value.trim();
  if (v.startsWith(hint.prefix) && v.length >= hint.minLength) return null;
  return `Doesn't look like a ${PROVIDER_LABELS[provider]} key (expected "${hint.prefix}…"). You can still save it.`;
}

/**
 * Provider + model picker pair, shared by the generation and review model
 * blocks. Edits are draft-local; switching provider remembers the model you
 * had chosen for each provider and restores it when you switch back.
 */
function ModelPicker({
  idPrefix,
  value,
  onChange,
  providerIds,
}: {
  idPrefix: string;
  value: AiSettings;
  onChange: (next: AiSettings) => void;
  providerIds: AiProviderId[];
}) {
  const keyPreview = useSecretPreview(value.provider);
  const availableModels = useAvailableModels(value, Boolean(keyPreview.data));
  const models = availableModels.data?.models ?? [];
  const needsKey = PROVIDERS_REQUIRING_KEY.includes(value.provider);
  const isCli = isCliProvider(value.provider);
  const modelMemory = useRef<Partial<Record<AiProviderId, string>>>({});

  function switchProvider(provider: AiProviderId) {
    modelMemory.current[value.provider] = value.model;
    onChange({
      ...value,
      provider,
      model:
        modelMemory.current[provider] ?? MODEL_SUGGESTIONS[provider][0] ?? "",
    });
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
        <Select
          items={PROVIDER_LABELS}
          value={value.provider}
          onValueChange={(v) => {
            if (v) switchProvider(v as AiProviderId);
          }}
        >
          <SelectTrigger id={`${idPrefix}-provider`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerIds.map((id) => (
              <SelectItem key={id} value={id}>
                {PROVIDER_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-model`}>Model</Label>
        <Combobox
          items={models}
          inputValue={value.model}
          onInputValueChange={(model) => onChange({ ...value, model })}
          value={models.includes(value.model) ? value.model : null}
          onValueChange={(model) => {
            if (model) onChange({ ...value, model });
          }}
          openOnInputClick
        >
          <ComboboxInput
            id={`${idPrefix}-model`}
            className="w-full"
            placeholder={MODEL_SUGGESTIONS[value.provider][0]}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              No matching models — the typed id is used as-is
            </ComboboxEmpty>
            <ComboboxList>
              {(item: string) => (
                <ComboboxItem key={item} value={item}>
                  <span className="truncate font-mono">{item}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <p className="text-xs text-muted-foreground">
          {isCli
            ? "Model alias passed to the CLI (e.g. sonnet, opus)"
            : availableModels.isPending
              ? "Loading models…"
              : availableModels.data?.live
                ? `${models.length} models from ${PROVIDER_LABELS[value.provider]}`
                : needsKey
                  ? "Suggestions only — save an API key to load the live list"
                  : "Suggestions only — provider list unavailable"}
        </p>
      </div>
    </div>
  );
}

/**
 * Detection + optional binary-path override for a CLI review provider. Shows
 * whether the CLI is installed and signed in, since there's no API key to save.
 */
function CliReviewConfig({
  value,
  onChange,
}: {
  value: AiSettings;
  onChange: (next: AiSettings) => void;
}) {
  const kind = providerKind(value.provider);
  const detect = useQuery({
    queryKey: ["agent-detect", value.provider, value.cliPath ?? ""],
    queryFn: () => detectAgentCli(kind!, value.cliPath),
    enabled: Boolean(kind),
    staleTime: 60_000,
  });
  const info = detect.data;
  const version = info?.version ? ` (${info.version})` : "";

  return (
    <div className="space-y-2">
      <Label htmlFor="cli-path">
        CLI path{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id="cli-path"
        autoComplete="off"
        placeholder="Auto-detect on PATH"
        value={value.cliPath ?? ""}
        onChange={(e) => onChange({ ...value, cliPath: e.target.value })}
      />
      <div className="text-xs">
        {detect.isPending ? (
          <span className="text-muted-foreground">
            Checking for {PROVIDER_LABELS[value.provider]}…
          </span>
        ) : info?.found && info.authed === "notAuthed" ? (
          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <XCircleIcon className="size-4 shrink-0" />
            Found{version} but not signed in — run{" "}
            <code className="font-mono">claude login</code>.
          </span>
        ) : info?.found ? (
          <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <CheckCircleIcon className="size-4 shrink-0" />
            Found{version}
            {info.authed === "authed" ? " — signed in" : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-destructive">
            <XCircleIcon className="size-4 shrink-0" />
            Not found — install it or set the path above.
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Uses the CLI's own subscription login — no API key needed. Reviews run
        read-only.
      </p>
    </div>
  );
}

export const AiProviderSection = withForm({
  ...settingsFormOpts,
  render: function AiProviderSectionRender({ form }) {
    const queryClient = useQueryClient();
    const ai = useSelector(form.store, (s) => s.values.ai);
    const reviewAi = useSelector(form.store, (s) => s.values.reviewAi);
    const provider = ai.provider;
    const needsKey = PROVIDERS_REQUIRING_KEY.includes(provider);
    const keyPreview = useSecretPreview(provider);

    const [confirmClear, setConfirmClear] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<{
      ok: boolean;
      message?: string;
    } | null>(null);

    // Keys save immediately to the OS keychain (they're not part of the
    // settings draft), so they get their own little form.
    const keyForm = useAppForm({
      defaultValues: { key: "" },
      onSubmit: async ({ value }) => {
        try {
          await setSecret(provider, value.key.trim());
          keyForm.reset({ key: "" });
          queryClient.invalidateQueries({
            queryKey: settingsKeys.secret(provider),
          });
          toast.success(
            `${PROVIDER_LABELS[provider]} key saved to OS keychain`,
          );
        } catch (e) {
          toastError(e);
        }
      },
    });

    function setAi(next: AiSettings) {
      setTestResult(null);
      form.setFieldValue("ai", next);
    }

    async function clearKey() {
      try {
        await deleteSecret(provider);
        queryClient.invalidateQueries({
          queryKey: settingsKeys.secret(provider),
        });
        setConfirmClear(false);
        toast.success("Key removed");
      } catch (e) {
        toastError(e);
      }
    }

    async function testConnection() {
      setTesting(true);
      setTestResult(null);
      try {
        const client = await createAiClient(ai);
        const result = await client.testConnection();
        setTestResult(
          result.ok ? { ok: true } : { ok: false, message: result.message },
        );
      } catch (e) {
        setTestResult({ ok: false, message: errorMessage(e) });
      } finally {
        setTesting(false);
      }
    }

    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">AI provider</h2>
          <p className="text-xs text-muted-foreground">
            Powers commit message and pull request generation. API keys are
            stored in the OS keychain, never in app files.
          </p>
        </div>

        <ModelPicker
          idPrefix="ai"
          value={ai}
          onChange={setAi}
          providerIds={GENERATION_PROVIDER_IDS}
        />

        {provider === "ollama" && (
          <div className="space-y-2">
            <Label htmlFor="ollama-url">Ollama URL</Label>
            <Input
              id="ollama-url"
              autoComplete="off"
              value={ai.ollamaBaseUrl}
              onChange={(e) => setAi({ ...ai, ollamaBaseUrl: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Only localhost is allowed by the app's network policy.
            </p>
          </div>
        )}

        {needsKey && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              keyForm.handleSubmit();
            }}
          >
            <div className="space-y-2">
              <Label>
                API key{" "}
                <span className="font-normal text-muted-foreground">
                  {keyPreview.data
                    ? `(saved: ${keyPreview.data.masked}, ${keyPreview.data.length} chars)`
                    : "(no key saved)"}
                </span>
              </Label>
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <keyForm.AppField
                    name="key"
                    validators={{ onChange: ({ value }) => required(value) }}
                  >
                    {(field) => (
                      <field.TextField
                        type="password"
                        placeholder={
                          keyPreview.data
                            ? "Enter a new key to replace the saved one"
                            : "Paste your API key"
                        }
                        warning={(value) => keyShapeWarning(provider, value)}
                      />
                    )}
                  </keyForm.AppField>
                </div>
                <keyForm.AppForm>
                  <keyForm.SubmitButton>Save</keyForm.SubmitButton>
                </keyForm.AppForm>
                {keyPreview.data && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmClear(true)}
                  >
                    Clear
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Keys apply immediately and are shared by every feature using
                this provider.
              </p>
            </div>
          </form>
        )}

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={testConnection}
            disabled={testing}
          >
            {testing && <Spinner data-icon="inline-start" />}
            Test connection
          </Button>
          {testResult?.ok && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircleIcon className="size-4" /> Connected
            </span>
          )}
          {testResult && !testResult.ok && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-destructive">
              <XCircleIcon className="size-4 shrink-0" />
              <span className="line-clamp-2">{testResult.message}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Copy error message"
                className="shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(testResult.message ?? "");
                  toast.success("Copied");
                }}
              >
                <CopyIcon />
              </Button>
            </span>
          )}
        </div>

        <div className="space-y-4 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Review model</h3>
            <p className="text-xs text-muted-foreground">
              Used by AI code review on pull requests. Can differ from the
              generation model above; shares the same per-provider API keys.
            </p>
          </div>
          <ModelPicker
            idPrefix="review"
            value={reviewAi}
            onChange={(next) => form.setFieldValue("reviewAi", next)}
            providerIds={ALL_PROVIDER_IDS}
          />
          {isCliProvider(reviewAi.provider) && (
            <CliReviewConfig
              value={reviewAi}
              onChange={(next) => form.setFieldValue("reviewAi", next)}
            />
          )}
        </div>

        <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove the saved key?</DialogTitle>
              <DialogDescription>
                Deletes the {PROVIDER_LABELS[provider]} API key from the OS
                keychain. AI features using {PROVIDER_LABELS[provider]} will
                stop working until a new key is saved. This can't be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmClear(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={clearKey}>
                Remove key
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  },
});
