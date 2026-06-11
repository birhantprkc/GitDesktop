import {
  ArrowSquareOutIcon,
  CopyIcon,
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  TerminalIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyText } from "@/lib/clipboard";
import {
  ghRepoUrl,
  openInTerminal,
  openWithDefault,
  openWithProgram,
} from "@/lib/git/api";
import { useGhStatus } from "@/lib/git/queries";
import { useRemoveRecentRepo, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

export function RepositoryMenu({ repoPath }: { repoPath: string }) {
  const gh = useGhStatus(repoPath);
  const settings = useSettings();
  const removeRecent = useRemoveRecentRepo();
  const closeRepo = useUiStore((s) => s.closeRepo);

  const canGh = Boolean(
    gh.data?.installed && gh.data?.authenticated && gh.data?.repo,
  );
  const editor = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";

  const onError = (e: unknown) => toastError(e);

  async function openWeb(suffix = "") {
    try {
      const url = await ghRepoUrl(repoPath);
      await openUrl(`${url}${suffix}`);
    } catch (e) {
      onError(e);
    }
  }

  function remove() {
    removeRecent.mutate(repoPath, {
      onSuccess: () => closeRepo(),
      onError,
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Repository actions"
          />
        }
      >
        <DotsThreeVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        {canGh && (
          <>
            <DropdownMenuItem onClick={() => openWeb()}>
              <ArrowSquareOutIcon />
              View on GitHub
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openWeb("/issues/new")}>
              <WarningCircleIcon />
              Create issue on GitHub
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={() =>
            openInTerminal(
              repoPath,
              settings.data?.terminal,
              settings.data?.terminalPath,
            ).catch(onError)
          }
        >
          <TerminalIcon />
          Open in terminal
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => openWithDefault(repoPath).catch(onError)}
        >
          <FolderOpenIcon />
          Show in Explorer
        </DropdownMenuItem>
        {editor && (
          <DropdownMenuItem
            onClick={() => openWithProgram(editor, repoPath).catch(onError)}
          >
            <PencilSimpleIcon />
            Open in {editorName}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => copyText(repoPath, "Repository path copied")}
        >
          <CopyIcon />
          Copy repository path
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={remove}>
          <TrashIcon />
          Remove from list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
