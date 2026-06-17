import { flushSync } from "react-dom";

const reduceMotion =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

/**
 * Runs a state update inside a View Transition (a calm crossfade between
 * top-level screens) when the browser supports it and the user hasn't asked for
 * reduced motion; otherwise applies the update immediately. `flushSync` lands
 * the React update synchronously so the transition captures before/after.
 *
 * Only call this from event handlers — never during render or an effect.
 */
export function startViewTransition(update: () => void): void {
  const doc = document as ViewTransitionDocument;
  if (reduceMotion?.matches || typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}
