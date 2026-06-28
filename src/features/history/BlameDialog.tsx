import hljs from "highlight.js/lib/common";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { diffLang } from "@/features/diff/diff-lang";
import { useBlame } from "@/lib/git/queries";
import { formatRelativeTime } from "@/lib/time";
import "@/features/diff/code-highlight.css";

/** One code line, syntax-highlighted when the language is recognized. */
function BlameCode({
  content,
  language,
}: {
  content: string;
  language: string | undefined;
}) {
  const html =
    language && hljs.getLanguage(language)
      ? hljs.highlight(content, { language, ignoreIllegals: true }).value
      : null;
  if (html === null) {
    return <span className="px-2 whitespace-pre-wrap">{content || " "}</span>;
  }
  return (
    <span
      className="gd-code px-2 whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: html || " " }}
    />
  );
}

/** `git blame` view: each line's content with the commit that last changed it. */
export function BlameDialog({
  repoPath,
  path,
  open,
  onOpenChange,
}: {
  repoPath: string;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const blame = useBlame(repoPath, open ? path : null);
  const lines = blame.data ?? [];
  const name = path.split("/").pop() ?? path;
  const lang = diffLang(path);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ph-no-capture: file name, path, and full file content — block from replay. */}
      <DialogContent className="ph-no-capture flex h-[80vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">Blame: {name}</DialogTitle>
          <DialogDescription className="truncate font-mono">
            {path}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 border">
          {blame.isPending ? (
            <div className="flex justify-center p-4">
              <Spinner />
            </div>
          ) : blame.isError ? (
            <p className="p-3 text-xs text-muted-foreground">
              Couldn't blame this file (it may be binary or untracked).
            </p>
          ) : lines.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Empty file.</p>
          ) : (
            <div className="font-mono text-[11px] leading-relaxed">
              {lines.map((line, i) => {
                // Show the commit gutter only when it changes, like git's blame.
                const newCommit = i === 0 || lines[i - 1].hash !== line.hash;
                const when = line.time
                  ? formatRelativeTime(new Date(line.time * 1000).toISOString())
                  : "";
                return (
                  <div
                    key={line.lineNo}
                    className="flex items-start hover:bg-muted/40"
                  >
                    <span
                      className="w-40 shrink-0 truncate border-r px-2 text-muted-foreground"
                      title={
                        newCommit
                          ? `${line.hash.slice(0, 7)} · ${line.author} · ${when}\n${line.summary}`
                          : undefined
                      }
                    >
                      {newCommit
                        ? `${line.hash.slice(0, 7)} ${line.author}`
                        : ""}
                    </span>
                    <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground/70">
                      {line.lineNo}
                    </span>
                    <BlameCode content={line.content} language={lang} />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
