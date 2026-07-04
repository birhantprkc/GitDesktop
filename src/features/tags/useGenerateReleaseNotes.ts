import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { createAiClient, MissingApiKeyError } from "@/lib/ai/client";
import { buildReleaseNotesPrompt } from "@/lib/ai/prompt";
import {
  ghReleaseGenerateNotes,
  gitCompareBranches,
  gitRecentCommits,
} from "@/lib/git/api";
import { loadSettings } from "@/lib/settings/api";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

/**
 * Drafts release notes with AI from the commits in this release — those in
 * `target` since `previousTag` (the prior release), falling back to recent
 * commits. Streams into the notes field so the user previews + edits before
 * publishing. Mirrors useGenerateIssueDraft.
 */
export function useGenerateReleaseNotes(repoPath: string) {
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  const generate = useCallback(
    async (opts: {
      tag: string;
      target: string;
      previousTag: string;
      repoName: string;
      /** True when the repo's provider is GitHub — gates the `gh` auto-changelog
       *  call so a GitLab/Bitbucket generate doesn't spawn a doomed subprocess. */
      isGitHub: boolean;
      onResult: (body: string) => void;
    }) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setGenerating(true);
      try {
        const settings = await loadSettings();

        // Prefer GitHub's auto-generated changelog (PR titles, authors, links) as
        // the source so the AI can organize + credit like GitHub does, rather
        // than guessing from bare commit subjects. Only GitHub provides this, so
        // skip the (otherwise doomed) `gh` subprocess on other providers.
        let changelog = "";
        if (opts.isGitHub) {
          try {
            const gen = await ghReleaseGenerateNotes(
              repoPath,
              opts.tag,
              opts.target,
              opts.previousTag,
            );
            changelog = gen.body ?? "";
          } catch {
            // gh unavailable / not usable here — fall back to local commits.
          }
        }

        let subjects: string[] = [];
        if (!changelog.trim()) {
          try {
            if (opts.previousTag && opts.target) {
              const cmp = await gitCompareBranches(
                repoPath,
                opts.previousTag,
                opts.target,
              );
              subjects = cmp.ahead.map((c) => c.subject);
            }
          } catch {
            // Range failed (e.g. unrelated refs) — fall back to recent commits.
          }
          if (subjects.length === 0) {
            subjects = (await gitRecentCommits(repoPath, 50)).map(
              (c) => c.subject,
            );
          }
        }

        const { system, prompt } = buildReleaseNotesPrompt({
          repoName: opts.repoName,
          version: opts.tag,
          commits: subjects,
          changelog,
          globalInstructions: settings.globalInstructions,
        });

        const client = await createAiClient(settings.ai);
        let buffer = "";
        for await (const chunk of client.stream({
          system,
          prompt,
          abortSignal: abort.signal,
        })) {
          buffer += chunk;
          opts.onResult(buffer);
        }
        if (!buffer.trim()) toast.error("Couldn't generate notes — try again.");
      } catch (e) {
        if (!abort.signal.aborted) {
          if (e instanceof MissingApiKeyError) {
            toast.error(e.message, {
              duration: 8000,
              action: {
                label: "Open settings",
                onClick: () => useUiStore.getState().openSettings("ai"),
              },
            });
          } else {
            toastError(e);
          }
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [repoPath],
  );

  return { generate, cancel, generating };
}
