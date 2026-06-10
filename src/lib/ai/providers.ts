import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import type { AiProviderId, AiSettings } from "./types";

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

export const PROVIDERS_REQUIRING_KEY: AiProviderId[] = [
  "anthropic",
  "openai",
  "openrouter",
];

export const MODEL_SUGGESTIONS: Record<AiProviderId, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  openai: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  openrouter: [
    "anthropic/claude-haiku-4.5",
    "openai/gpt-4.1-mini",
    "google/gemini-2.5-flash",
  ],
  ollama: ["llama3.1", "qwen2.5-coder", "mistral"],
};

// All providers get the Tauri fetch, which proxies through Rust and so
// is exempt from webview CORS (most AI APIs reject browser origins).
export function createModel(
  settings: AiSettings,
  apiKey: string | null,
): LanguageModel {
  const fetch = tauriFetch as typeof globalThis.fetch;
  switch (settings.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: apiKey ?? "", fetch })(settings.model);
    case "openai":
      return createOpenAI({ apiKey: apiKey ?? "", fetch })(settings.model);
    case "openrouter":
      return createOpenRouter({ apiKey: apiKey ?? "", fetch })(settings.model);
    case "ollama":
      return createOllama({
        baseURL: `${settings.ollamaBaseUrl.replace(/\/$/, "")}/api`,
        fetch,
      })(settings.model);
  }
}
