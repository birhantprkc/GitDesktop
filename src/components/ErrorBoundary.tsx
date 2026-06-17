import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { scrubError, track } from "@/lib/analytics";

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    const { message, kind } = scrubError(error);
    track({
      name: "error_caught",
      properties: { error_kind: kind, fatal: true, message },
    });
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
