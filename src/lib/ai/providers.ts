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
  "ollama-cloud": "Ollama Cloud",
  "claude-cli": "Claude Code (CLI)",
  "codex-cli": "Codex (CLI)",
  "copilot-cli": "GitHub Copilot (CLI)",
};

/** Host for Ollama's hosted models, reached with an API key (vs the local
 *  server). Native API at `/api`, OpenAI-compatible model list at `/v1/models`. */
export const OLLAMA_CLOUD_HOST = "https://ollama.com";

export const PROVIDERS_REQUIRING_KEY: AiProviderId[] = [
  "anthropic",
  "openai",
  "openrouter",
  "ollama-cloud",
];

/** Providers backed by a locally-installed coding-agent CLI rather than an
 *  HTTP API — they authenticate via the CLI's own login, not an API key, and
 *  run only on the review path (not commit/PR generation). */
export const CLI_PROVIDERS: AiProviderId[] = [
  "claude-cli",
  "codex-cli",
  "copilot-cli",
];

export const isCliProvider = (id: AiProviderId): boolean =>
  CLI_PROVIDERS.includes(id);

/** Providers whose work runs on the user's own machine — a CLI agent subprocess
 *  or local Ollama inference — rather than a cloud HTTP API. Concurrency for
 *  these is bound by the machine, not a provider rate limit. */
export const isLocalProvider = (id: AiProviderId): boolean =>
  isCliProvider(id) || id === "ollama";

export const ALL_PROVIDER_IDS = Object.keys(PROVIDER_LABELS) as AiProviderId[];

/** Providers offered for commit/PR message generation (CLI agents excluded). */
export const GENERATION_PROVIDER_IDS = ALL_PROVIDER_IDS.filter(
  (id) => !isCliProvider(id),
);

export const MODEL_SUGGESTIONS: Record<AiProviderId, string[]> = {
  anthropic: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
  openai: ["gpt-4.1-mini", "gpt-4.1", "o4-mini"],
  openrouter: [
    "anthropic/claude-haiku-4.5",
    "openai/gpt-4.1-mini",
    "google/gemini-2.5-flash",
  ],
  ollama: ["llama3.1", "qwen2.5-coder", "mistral"],
  "ollama-cloud": ["gpt-oss:120b", "qwen3-coder:480b", "deepseek-v3.1:671b"],
  // CLI model aliases passed straight to `claude --model`.
  "claude-cli": ["sonnet", "opus", "haiku", "fable"],
  // Codex: blank uses the account default (proven to work); user can type one.
  "codex-cli": [],
  // Copilot: a curated subset of the `/model` catalog (the picker still free-types
  // any id; blank = Copilot's own default). Slugs are the lowercased display names —
  // verified pattern from "Claude Haiku 4.5" → claude-haiku-4.5.
  "copilot-cli": [
    "auto",
    "gpt-5-mini",
    "claude-haiku-4.5",
    "claude-sonnet-4.6",
    "gpt-5.4",
    "gpt-5.3-codex",
    "mai-code-1-flash-picker",
  ],
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
    case "ollama-cloud":
      return createOllama({
        baseURL: `${OLLAMA_CLOUD_HOST}/api`,
        headers: { Authorization: `Bearer ${apiKey ?? ""}` },
        fetch,
      })(settings.model);
    case "claude-cli":
    case "codex-cli":
    case "copilot-cli":
      // CLI agents run as a subprocess, not through the AI SDK. Callers must
      // route these through the agent-CLI path before reaching createModel.
      throw new Error("CLI providers do not use the AI SDK model path");
  }
}
