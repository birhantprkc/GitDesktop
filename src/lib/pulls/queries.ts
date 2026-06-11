import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createLocalPr,
  deleteLocalPr,
  type LocalPr,
  listLocalPrs,
  saveLocalPr,
} from "./local";

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
