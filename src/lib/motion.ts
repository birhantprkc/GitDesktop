import type { Transition } from "motion/react";

/**
 * The single calm motion vocabulary for the app. Set `calmTransition` as the
 * MotionConfig default so every `m.*` component inherits it; reach for
 * `quickTransition` on frequent micro-swaps (button state, badges) so they never
 * feel sluggish. Ease-out only, 120–200ms — never spring/bounce (brand: calm,
 * precise). Matches the 200ms ease-out CSS view-transition baseline in App.css.
 */
export const calmTransition: Transition = { duration: 0.2, ease: "easeOut" };

export const quickTransition: Transition = { duration: 0.12, ease: "easeOut" };
