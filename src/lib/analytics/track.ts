import { posthog } from "./posthog";

// ---------------------------------------------------------------------------
// Event schema — only these events and properties are ever sent.
// Content-free: no paths, filenames, branch names, diff text, URLs, or secrets.
// ---------------------------------------------------------------------------

export type AnalyticsEvent =
  | { name: "screen_viewed"; properties: { screen: string } }
  | {
      name: "repo_opened";
      properties: { source: "recent" | "clone" | "create" | "picker" };
    }
  | {
      name: "commit_created";
      properties: {
        file_count: number;
        has_ai_message: boolean;
        has_co_authors: boolean;
      };
    }
  | {
      name: "pull_request_created";
      properties: { is_draft: boolean; has_ai_description: boolean };
    }
  | {
      name: "ai_review_triggered";
      properties: { provider: string; model_tier: string };
    }
  | {
      name: "error_caught";
      properties: { error_kind: string; fatal: boolean; message: string };
    };

export function track(event: AnalyticsEvent): void {
  try {
    posthog.capture(event.name, event.properties);
  } catch {
    // Never let analytics break the app.
  }
}
