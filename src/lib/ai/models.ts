import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getSecret } from "@/lib/git/api";
import { MODEL_SUGGESTIONS } from "./providers";
import type { AiSettings } from "./types";

export interface AvailableModels {
  models: string[];
  /** false when these are static fallback suggestions, not a provider list. */
  live: boolean;
}

/** OpenAI's /v1/models mixes in embeddings, audio, images… keep chat models. */
const OPENAI_NON_CHAT =
  /embed|whisper|tts|dall-e|audio|realtime|moderation|image|transcribe|babbage|davinci|codex|search/i;

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await tauriFetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  return res.json();
}

async function fetchProviderModels(settings: AiSettings): Promise<string[]> {
  switch (settings.provider) {
    case "openai": {
      const key = await getSecret("openai");
      if (!key) return [];
      const json = await fetchJson("https://api.openai.com/v1/models", {
        Authorization: `Bearer ${key}`,
      });
      return (json.data as { id: string }[])
        .map((m) => m.id)
        .filter((id) => !OPENAI_NON_CHAT.test(id))
        .sort();
    }
    case "anthropic": {
      const key = await getSecret("anthropic");
      if (!key) return [];
      const json = await fetchJson(
        "https://api.anthropic.com/v1/models?limit=100",
        {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      );
      return (json.data as { id: string }[]).map((m) => m.id);
    }
    case "openrouter": {
      // public endpoint, no key required
      const json = await fetchJson("https://openrouter.ai/api/v1/models");
      return (json.data as { id: string }[]).map((m) => m.id).sort();
    }
    case "ollama": {
      const base = settings.ollamaBaseUrl.replace(/\/$/, "");
      const json = await fetchJson(`${base}/api/tags`);
      return ((json.models ?? []) as { name: string }[])
        .map((m) => m.name)
        .sort();
    }
  }
}

/**
 * Live model list for the current provider, falling back to the static
 * suggestions when there's no key or the request fails.
 */
export function useAvailableModels(settings: AiSettings, keySaved: boolean) {
  return useQuery({
    queryKey: [
      "models",
      settings.provider,
      keySaved,
      settings.ollamaBaseUrl,
    ] as const,
    queryFn: async (): Promise<AvailableModels> => {
      try {
        const models = await fetchProviderModels(settings);
        if (models.length > 0) {
          return { models, live: true };
        }
      } catch {
        // fall through to suggestions
      }
      return { models: MODEL_SUGGESTIONS[settings.provider], live: false };
    },
    staleTime: 5 * 60 * 1000,
  });
}
