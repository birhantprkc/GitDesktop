import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { createAiClient } from "@/lib/ai/client";
import { useAvailableModels } from "@/lib/ai/models";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  PROVIDERS_REQUIRING_KEY,
} from "@/lib/ai/providers";
import type { AiProviderId } from "@/lib/ai/types";
import { deleteSecret, setSecret } from "@/lib/git/api";
import type { AppSettings } from "@/lib/settings/api";
import {
  settingsKeys,
  useSaveSettings,
  useSecretPreview,
} from "@/lib/settings/queries";
import { errorMessage } from "@/lib/tauri/invoke";

const PROVIDER_IDS = Object.keys(PROVIDER_LABELS) as AiProviderId[];

/** Typical key shapes per provider; used for a soft warning, never to block. */
const KEY_HINTS: Partial<
  Record<AiProviderId, { prefix: string; minLength: number }>
> = {
  openai: { prefix: "sk-", minLength: 40 },
  anthropic: { prefix: "sk-ant-", minLength: 40 },
  openrouter: { prefix: "sk-or-", minLength: 40 },
};

export function AiProviderSection({ settings }: { settings: AppSettings }) {
  const saveSettings = useSaveSettings();
  const queryClient = useQueryClient();
  const provider = settings.ai.provider;
  const needsKey = PROVIDERS_REQUIRING_KEY.includes(provider);
  const keyPreview = useSecretPreview(provider);
  const availableModels = useAvailableModels(
    settings.ai,
    Boolean(keyPreview.data),
  );
  const models = availableModels.data?.models ?? [];

  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message?: string;
  } | null>(null);

  function updateAi(patch: Partial<AppSettings["ai"]>) {
    setTestResult(null);
    saveSettings.mutate({ ...settings, ai: { ...settings.ai, ...patch } });
  }

  async function saveKey() {
    setSavingKey(true);
    try {
      const value = keyInput.trim();
      await setSecret(provider, value);
      setKeyInput("");
      queryClient.invalidateQueries({
        queryKey: settingsKeys.secret(provider),
      });
      const hint = KEY_HINTS[provider];
      if (
        hint &&
        (!value.startsWith(hint.prefix) || value.length < hint.minLength)
      ) {
        toast.warning(
          `Saved, but this doesn't look like a ${PROVIDER_LABELS[provider]} key ` +
            `(expected to start with "${hint.prefix}" and be longer). ` +
            "Double-check what you pasted.",
          { duration: 8000 },
        );
      } else {
        toast.success(`${PROVIDER_LABELS[provider]} key saved to OS keychain`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSavingKey(false);
    }
  }

  async function clearKey() {
    try {
      await deleteSecret(provider);
      queryClient.invalidateQueries({
        queryKey: settingsKeys.secret(provider),
      });
      toast.success("Key removed");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const client = await createAiClient(settings.ai);
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
          Used to generate commit messages. Keys are stored in the OS keychain,
          never in app files.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => {
              if (value) {
                updateAi({
                  provider: value as AiProviderId,
                  model: MODEL_SUGGESTIONS[value as AiProviderId][0] ?? "",
                });
              }
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ai-model">Model</Label>
          <Combobox
            items={models}
            inputValue={settings.ai.model}
            onInputValueChange={(value) => updateAi({ model: value })}
            value={
              models.includes(settings.ai.model) ? settings.ai.model : null
            }
            onValueChange={(value) => {
              if (value) updateAi({ model: value });
            }}
            openOnInputClick
          >
            <ComboboxInput
              id="ai-model"
              className="w-full"
              placeholder={MODEL_SUGGESTIONS[provider][0]}
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
            {availableModels.isPending
              ? "Loading models…"
              : availableModels.data?.live
                ? `${models.length} models from ${PROVIDER_LABELS[provider]}`
                : needsKey
                  ? "Suggestions only — save an API key to load the live list"
                  : "Suggestions only — provider list unavailable"}
          </p>
        </div>
      </div>

      {provider === "ollama" && (
        <div className="space-y-2">
          <Label htmlFor="ollama-url">Ollama URL</Label>
          <Input
            id="ollama-url"
            value={settings.ai.ollamaBaseUrl}
            onChange={(e) => updateAi({ ollamaBaseUrl: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Only localhost is allowed by the app's network policy.
          </p>
        </div>
      )}

      {needsKey && (
        <div className="space-y-2">
          <Label htmlFor="api-key">
            API key{" "}
            <span className="font-normal text-muted-foreground">
              {keyPreview.data
                ? `(saved: ${keyPreview.data.masked}, ${keyPreview.data.length} chars)`
                : "(no key saved)"}
            </span>
          </Label>
          <div className="flex gap-2">
            <Input
              id="api-key"
              type="password"
              placeholder={
                keyPreview.data
                  ? "Enter a new key to replace the saved one"
                  : "Paste your API key"
              }
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="flex-1"
            />
            <Button onClick={saveKey} disabled={!keyInput.trim() || savingKey}>
              {savingKey && <Spinner data-icon="inline-start" />}
              Save
            </Button>
            {keyPreview.data && (
              <Button variant="destructive" onClick={clearKey}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={testConnection} disabled={testing}>
          {testing && <Spinner data-icon="inline-start" />}
          Test connection
        </Button>
        {testResult?.ok && (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircleIcon className="size-4" /> Connected
          </span>
        )}
        {testResult && !testResult.ok && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <XCircleIcon className="size-4 shrink-0" />
            <span className="line-clamp-2">{testResult.message}</span>
          </span>
        )}
      </div>
    </section>
  );
}
