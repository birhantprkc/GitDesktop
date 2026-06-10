import { WarningIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function GitMissingScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>Git not found</AlertTitle>
          <AlertDescription>
            GitDesktop needs the git command-line tool on your PATH. Install it,
            then retry.
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={onRetry}>Retry</Button>
          <Button
            variant="outline"
            onClick={() => openUrl("https://git-scm.com/downloads")}
          >
            Download Git
          </Button>
        </div>
      </div>
    </div>
  );
}
