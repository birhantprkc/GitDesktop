import { generateText, streamText } from "ai";
import { getSecret } from "@/lib/git/api";
import { errorMessage } from "@/lib/tauri/invoke";
import { createModel, PROVIDERS_REQUIRING_KEY } from "./providers";
import type { AiClient, AiSettings, AiStreamRequest } from "./types";

export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    super(`No API key saved for ${provider}. Add one in Settings.`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Builds a client for `settings`. `apiKeyOverride` lets a caller (e.g. the
 * Settings "Test connection" button) try a key that's been typed but not yet
 * saved to the keychain; when empty, the saved key is used.
 */
export async function createAiClient(
  settings: AiSettings,
  apiKeyOverride?: string,
): Promise<AiClient> {
  const needsKey = PROVIDERS_REQUIRING_KEY.includes(settings.provider);
  const override = apiKeyOverride?.trim();
  const apiKey = needsKey
    ? override || (await getSecret(settings.provider))
    : null;
  if (needsKey && !apiKey) {
    throw new MissingApiKeyError(settings.provider);
  }
  const model = createModel(settings, apiKey);

  return {
    async *stream(req: AiStreamRequest) {
      const result = streamText({
        model,
        system: req.system,
        prompt: req.prompt,
        abortSignal: req.abortSignal,
      });
      for await (const chunk of result.textStream) {
        yield chunk;
      }
    },
    async testConnection() {
      try {
        const result = await generateText({
          model,
          prompt: 'Reply with exactly the word "OK".',
        });
        return result.text.length > 0
          ? ({ ok: true } as const)
          : ({
              ok: false,
              message: "Model returned an empty response.",
            } as const);
      } catch (e) {
        return { ok: false, message: errorMessage(e) } as const;
      }
    },
  };
}
