import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiProviderId } from "@/lib/ai/types";
import { getSecret } from "@/lib/git/api";
import {
  type AppSettings,
  addRecentRepo,
  loadSettings,
  removeRecentRepo,
  saveSettings,
} from "./api";

export const settingsKeys = {
  settings: ["settings"] as const,
  secret: (provider: AiProviderId) => ["secret-present", provider] as const,
};

export function useSettings() {
  return useQuery({
    queryKey: settingsKeys.settings,
    queryFn: loadSettings,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AppSettings) => saveSettings(settings),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings }),
  });
}

export function useAddRecentRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (repo: { path: string; name: string }) => addRecentRepo(repo),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings }),
  });
}

export function useRemoveRecentRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => removeRecentRepo(path),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings }),
  });
}

export interface SecretPreview {
  length: number;
  /** e.g. "sk-pro…f3Kd" — enough to recognize a key without exposing it. */
  masked: string;
}

export function useSecretPreview(provider: AiProviderId) {
  return useQuery({
    queryKey: settingsKeys.secret(provider),
    queryFn: async (): Promise<SecretPreview | null> => {
      const value = await getSecret(provider);
      if (!value) return null;
      const prefix = value.slice(0, Math.min(6, value.length));
      const suffix = value.length > 12 ? value.slice(-4) : "";
      return { length: value.length, masked: `${prefix}…${suffix}` };
    },
  });
}
