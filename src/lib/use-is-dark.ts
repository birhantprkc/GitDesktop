import { useSyncExternalStore } from "react";

/** OS color-scheme media query, shared so we don't create one per module. */
export const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/**
 * Reactive `prefers-color-scheme: dark`, for components that theme themselves in
 * JS (the diff viewer, the code editor). The app follows the OS scheme; the
 * `.dark` class is toggled once in main.tsx.
 */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    (notify) => {
      darkQuery.addEventListener("change", notify);
      return () => darkQuery.removeEventListener("change", notify);
    },
    () => darkQuery.matches,
  );
}
