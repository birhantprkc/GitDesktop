import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  /** When this changes, a caught error is cleared (e.g. a new file/commit). */
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains crashes from the third-party diff renderer to the diff pane, so a
 * single bad diff can't take down the whole app. The specific unguarded-line
 * crash we hit is fixed at the source (see patches/@git-diff-view__core), so
 * this is defense-in-depth against any future renderer throw. Selecting
 * another file/commit changes `resetKey` and clears the fallback.
 */
export class DiffErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    console.error("Diff render failed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
          <p className="text-xs">This file's diff couldn't be displayed.</p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
