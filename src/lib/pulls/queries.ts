import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLocalPr,
  deleteLocalPr,
  type LocalPr,
  listLocalPrs,
  saveLocalPr,
} from "./local";
import {
  clearReviewsFor,
  deleteReview,
  listReviews,
  updateReviewText,
} from "./reviews-history";

const localPrKey = (repo: string) => ["local-prs", repo] as const;

export function useLocalPrs(repo: string) {
  return useQuery({
    queryKey: localPrKey(repo),
    queryFn: () => listLocalPrs(repo),
  });
}

function useLocalPrMutation<TArgs, TData>(
  repo: string,
  fn: (args: TArgs) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: localPrKey(repo) }),
  });
}

export function useCreateLocalPr(repo: string) {
  return useLocalPrMutation(
    repo,
    (input: { title: string; body: string; base: string; head: string }) =>
      createLocalPr(repo, input),
  );
}

export function useSaveLocalPr(repo: string) {
  return useLocalPrMutation(repo, (pr: LocalPr) => saveLocalPr(repo, pr));
}

export function useDeleteLocalPr(repo: string) {
  return useLocalPrMutation(repo, (id: string) => deleteLocalPr(repo, id));
}

type PrKind = "remote" | "local";

const reviewHistoryKey = (repo: string, kind: PrKind, ref: string) =>
  ["review-history", repo, kind, ref] as const;

/** Persisted AI reviews for a PR (both modes), newest first. Read-only — never
 *  creates a record, so a never-reviewed PR's first run stays unchanged. */
export function useReviewHistory(repo: string, kind: PrKind, ref: string) {
  return useQuery({
    queryKey: reviewHistoryKey(repo, kind, ref),
    queryFn: () => listReviews(repo, kind, ref),
  });
}

function useReviewHistoryMutation<TArgs>(
  repo: string,
  kind: PrKind,
  ref: string,
  fn: (args: TArgs) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: reviewHistoryKey(repo, kind, ref),
      }),
  });
}

/** Edits a stored review's text — backs "trim before re-running". */
export function useUpdateReviewText(repo: string, kind: PrKind, ref: string) {
  return useReviewHistoryMutation(
    repo,
    kind,
    ref,
    ({ id, text }: { id: string; text: string }) =>
      updateReviewText(repo, id, text),
  );
}

export function useDeleteReview(repo: string, kind: PrKind, ref: string) {
  return useReviewHistoryMutation(repo, kind, ref, (id: string) =>
    deleteReview(repo, id),
  );
}

export function useClearReviews(repo: string, kind: PrKind, ref: string) {
  return useReviewHistoryMutation(repo, kind, ref, () =>
    clearReviewsFor(repo, kind, ref),
  );
}
