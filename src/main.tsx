import { QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initAnalytics, trackCaughtError } from "@/lib/analytics";
import { calmTransition } from "@/lib/motion";
import { queryClient } from "@/lib/query-client";
import { loadSettings } from "@/lib/settings/api";
import { darkQuery } from "@/lib/use-is-dark";
import App from "./App.tsx";
import "./App.css";
import "@git-diff-view/react/styles/diff-view.css";

// Follow the OS color scheme; the theme css switches on the .dark class.
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", darkQuery.matches);
darkQuery.addEventListener("change", applyTheme);
applyTheme();

// Boot analytics after settings load — never blocks the render. Session replay
// stays off unless the user opted in (recordReplay).
loadSettings()
  .then((s) => initAnalytics(s.analyticsEnabled, s.recordReplay))
  .catch(() => {
    // Analytics is best-effort — never surface its failures.
  });

// Wire up unhandled errors to PostHog after the page loads. trackCaughtError
// dedupes by identity, so errors already reported by an ErrorBoundary (fatal)
// aren't re-counted here as non-fatal.
window.addEventListener("error", (e) => {
  trackCaughtError(e.error ?? e.message, false);
});
window.addEventListener("unhandledrejection", (e) => {
  trackCaughtError(e.reason, false);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          {/* One calm motion baseline: reducedMotion="user" disables transform/
              layout motion for users who ask (opacity still fades); LazyMotion +
              `m` keeps the bundle small (use m.*, never motion.*). */}
          <LazyMotion features={domAnimation} strict>
            <MotionConfig reducedMotion="user" transition={calmTransition}>
              <App />
            </MotionConfig>
          </LazyMotion>
        </ErrorBoundary>
        <Toaster position="bottom-right" closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
