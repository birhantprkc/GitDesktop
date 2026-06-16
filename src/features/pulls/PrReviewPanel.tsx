import { ShieldCheckIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
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
import { Markdown } from "@/components/ui/markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { detectAgentCli, providerKind } from "@/lib/ai/agent";
import { useAvailableModels } from "@/lib/ai/models";
import {
  MODEL_SUGGESTIONS,
  PROVIDER_LABELS,
  PROVIDERS_REQUIRING_KEY,
} from "@/lib/ai/providers";
import type { AiProviderId, ReviewMode } from "@/lib/ai/types";
import {
  useSaveSettings,
  useSecretPreview,
  useSettings,
} from "@/lib/settings/queries";
import { type ReviewContext, useGenerateReview } from "./useGenerateReview";

const PROVIDER_IDS = Object.keys(PROVIDER_LABELS) as AiProviderId[];

export function PrReviewPanel({
  context,
  onPost,
  posting,
}: {
  context: ReviewContext;
  onPost?: (body: string) => void | Promise<void>;
  posting?: boolean;
}) {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const { generate, cancel, reset, generating, text, status } =
    useGenerateReview();
  const [lastMode, setLastMode] = useState<ReviewMode>("general");

  const reviewAi = settings.data?.reviewAi;
  const provider = reviewAi?.provider ?? "anthropic";
  const needsKey = PROVIDERS_REQUIRING_KEY.includes(provider);
  const keyPreview = useSecretPreview(provider);
  const cliKind = providerKind(provider);
  const cliDetect = useQuery({
    queryKey: ["agent-detect", provider, reviewAi?.cliPath ?? ""],
    queryFn: () => detectAgentCli(cliKind!, reviewAi?.cliPath),
    enabled: Boolean(cliKind),
    staleTime: 60_000,
  });
  const available = useAvailableModels(
    reviewAi ?? { provider, model: "", ollamaBaseUrl: "" },
    Boolean(keyPreview.data),
  );
  const models = available.data?.models ?? [];

  function updateReview(patch: Partial<NonNullable<typeof reviewAi>>) {
    if (!settings.data || !reviewAi) return;
    saveSettings.mutate({
      ...settings.data,
      reviewAi: { ...reviewAi, ...patch },
    });
  }

  function run(mode: ReviewMode) {
    if (!reviewAi) return;
    setLastMode(mode);
    generate(reviewAi, mode, context);
  }

  async function post() {
    if (!onPost || !text.trim() || posting) return;
    const label = lastMode === "security" ? "security audit" : "review";
    const body = `**AI ${label} (${reviewAi?.model ?? "model"})**\n\n${text}`;
    try {
      await onPost(body);
      reset();
      toast.success("Review posted to the conversation");
    } catch {
      // The caller surfaces the error; keep the text so it isn't lost.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={provider}
            onValueChange={(v) => {
              if (v)
                updateReview({
                  provider: v as AiProviderId,
                  model: MODEL_SUGGESTIONS[v as AiProviderId][0] ?? "",
                });
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
          <Combobox
            items={models}
            inputValue={reviewAi?.model ?? ""}
            onInputValueChange={(v) => updateReview({ model: v })}
            value={
              reviewAi && models.includes(reviewAi.model)
                ? reviewAi.model
                : null
            }
            onValueChange={(v) => v && updateReview({ model: v })}
            openOnInputClick
          >
            <ComboboxInput
              className="w-full"
              placeholder={MODEL_SUGGESTIONS[provider][0]}
            />
            <ComboboxContent>
              <ComboboxEmpty>Uses the typed id as-is</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    <span className="truncate font-mono">{item}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        {needsKey && !keyPreview.data && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            No {PROVIDER_LABELS[provider]} API key saved — add one in Settings
            to run a review.
          </p>
        )}
        {cliKind && cliDetect.data && !cliDetect.data.found && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {PROVIDER_LABELS[provider]} not found — install it or set its path
            in Settings.
          </p>
        )}
        {cliKind &&
          cliDetect.data?.found &&
          cliDetect.data.authed === "notAuthed" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {PROVIDER_LABELS[provider]} is installed but not signed in — run{" "}
              <code className="font-mono">
                {cliKind === "codex" ? "codex login" : "claude login"}
              </code>{" "}
              in a terminal.
            </p>
          )}
        <div className="flex flex-wrap items-center gap-2">
          {generating ? (
            <Button variant="outline" size="sm" onClick={cancel}>
              <XIcon data-icon="inline-start" />
              Cancel
            </Button>
          ) : (
            <>
              <Button size="sm" onClick={() => run("general")}>
                <SparkleIcon data-icon="inline-start" />
                Review
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => run("security")}
              >
                <ShieldCheckIcon data-icon="inline-start" />
                Security audit
              </Button>
            </>
          )}
          {onPost && text.trim() && !generating && (
            <Button variant="ghost" size="sm" disabled={posting} onClick={post}>
              {posting && <Spinner data-icon="inline-start" />}
              Post as comment
            </Button>
          )}
        </div>
        {cliKind === "claude" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              size="sm"
              checked={Boolean(reviewAi?.cliRepoAware)}
              onCheckedChange={(checked) =>
                updateReview({ cliRepoAware: checked })
              }
              disabled={generating}
            />
            Read repo files for context (slower, deeper)
          </label>
        )}
        {cliKind === "codex" && (
          <p className="text-xs text-muted-foreground">
            Codex reads repo files for context (read-only sandbox).
          </p>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {text.trim() ? (
            <Markdown>{text}</Markdown>
          ) : generating ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              {status || "Starting review…"}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Run a general review or a security audit of this PR's changes with
              the selected model. The result appears here and isn't shared
              unless you post it.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
