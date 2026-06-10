import { useFileDiff } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { DiffPlaceholder } from "./DiffPlaceholder";
import { DiffSurface } from "./DiffSurface";

/** Working-tree diff for the file selected in the changes panel. */
export function DiffViewer({ repoPath }: { repoPath: string }) {
  const selectedFile = useUiStore((s) => s.selectedFile);
  const diff = useFileDiff(repoPath, selectedFile);

  if (!selectedFile) {
    return <DiffPlaceholder message="Select a file to see its changes" />;
  }
  return <DiffSurface filePath={selectedFile.path} diff={diff} />;
}
