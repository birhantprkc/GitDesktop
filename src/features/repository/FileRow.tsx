import { MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyText } from "@/lib/clipboard";
import {
  openWithDefault,
  openWithProgram,
  revealInExplorer,
} from "@/lib/git/api";
import { useAppendToGitignore } from "@/lib/git/queries";
import type { ChangeKind, FileEntry } from "@/lib/git/types";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

const KIND_BADGE: Record<ChangeKind, { letter: string; className: string }> = {
  added: { letter: "A", className: "text-green-600 dark:text-green-400" },
  untracked: { letter: "U", className: "text-green-600 dark:text-green-400" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400" },
  typechange: { letter: "T", className: "text-amber-600 dark:text-amber-400" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { letter: "R", className: "text-blue-600 dark:text-blue-400" },
  copied: { letter: "C", className: "text-blue-600 dark:text-blue-400" },
  conflicted: { letter: "!", className: "text-destructive" },
};

/** "src/lib/x.ts" -> ["src/lib", "src"] (closest folder first). */
function ancestorFolders(path: string): string[] {
  const folders: string[] = [];
  let current = path;
  for (;;) {
    const slash = current.lastIndexOf("/");
    if (slash === -1) break;
    current = current.slice(0, slash);
    folders.push(current);
  }
  return folders;
}

export function FileRow({
  entry,
  kind,
  staged,
  selected,
  disabled,
  repoPath,
  onSelect,
  onToggle,
  onDiscard,
}: {
  entry: FileEntry;
  kind: ChangeKind;
  staged: boolean;
  selected: boolean;
  disabled: boolean;
  repoPath: string;
  onSelect: () => void;
  onToggle: () => void;
  onDiscard?: () => void;
}) {
  const appendIgnore = useAppendToGitignore(repoPath);
  const settings = useSettings();
  const externalEditor = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";
  const badge = KIND_BADGE[kind];
  const label = entry.origPath
    ? `${entry.origPath} → ${entry.path}`
    : entry.path;
  const absolutePath = `${repoPath}\\${entry.path.replaceAll("/", "\\")}`;
  const folders = ancestorFolders(entry.path);
  const dot = entry.path.lastIndexOf(".");
  const extension =
    dot > entry.path.lastIndexOf("/") + 1 ? entry.path.slice(dot + 1) : null;

  function ignore(pattern: string) {
    appendIgnore.mutate(pattern, {
      onSuccess: () => toast.success(`Added "${pattern}" to .gitignore`),
      onError: (e) => toastError(e),
    });
  }

  const onError = (e: unknown) => toastError(e);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={cn(
              "group flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-xs",
              selected
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/60",
            )}
            onClick={onSelect}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect();
            }}
            role="button"
            tabIndex={0}
          >
            <span className={cn("w-3 shrink-0 font-semibold", badge.className)}>
              {badge.letter}
            </span>
            <span className="min-w-0 flex-1 truncate" title={label}>
              {label}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label={
                staged ? `Unstage ${entry.path}` : `Stage ${entry.path}`
              }
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              {staged ? <MinusIcon /> : <PlusIcon />}
            </Button>
          </div>
        }
      />
      <ContextMenuContent className="min-w-64">
        {!staged && onDiscard && (
          <>
            <ContextMenuItem onClick={onDiscard}>
              Discard changes…
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onClick={() => ignore(`/${entry.path}`)}>
          Ignore file (add to .gitignore)
        </ContextMenuItem>
        {folders.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              Ignore folder (add to .gitignore)
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {folders.map((folder) => (
                <ContextMenuItem
                  key={folder}
                  onClick={() => ignore(`/${folder}/`)}
                >
                  <span className="font-mono">{folder}/</span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {extension && (
          <ContextMenuItem onClick={() => ignore(`*.${extension}`)}>
            Ignore all .{extension} files (add to .gitignore)
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => copyText(absolutePath, "Path copied")}>
          Copy file path
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => copyText(entry.path, "Relative path copied")}
        >
          Copy relative file path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={() => revealInExplorer(absolutePath).catch(onError)}
        >
          Show in Explorer
        </ContextMenuItem>
        {externalEditor && (
          <ContextMenuItem
            onClick={() =>
              openWithProgram(externalEditor, absolutePath).catch(onError)
            }
          >
            Open in {editorName}
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => openWithDefault(absolutePath).catch(onError)}
        >
          Open with default program
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
