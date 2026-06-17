import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initAnalytics, scrubError, track } from "@/lib/analytics";
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

// Wire up unhandled errors to PostHog after the page loads.
window.addEventListener("error", (e) => {
  const { message, kind } = scrubError(e.error ?? e.message);
  track({
    name: "error_caught",
    properties: { error_kind: kind, fatal: false, message },
  });
});
window.addEventListener("unhandledrejection", (e) => {
  const { message, kind } = scrubError(e.reason);
  track({
    name: "error_caught",
    properties: { error_kind: kind, fatal: false, message },
  });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
