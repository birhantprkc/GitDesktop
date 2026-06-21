import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { trackCaughtError } from "@/lib/analytics";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Runs before React re-dispatches the same error to window.onerror, so this
    // (fatal) report registers the error and the global handler skips it.
    trackCaughtError(error, true);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm font-medium">Something went wrong</p>
          <p className="max-w-lg text-center text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <Button size="sm" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
