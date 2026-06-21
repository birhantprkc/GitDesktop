import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MarkdownEditorHandle } from "@/components/markdown-editor";

/**
 * GitHub-style quote reply, shared by every PR/issue/discussion view (the
 * transform was copy-pasted in all five). Returns a callback that prefixes each
 * line of `body` with "> ", appends it to the composer draft (separated from any
 * existing text by a blank line, with two trailing newlines), and focuses the
 * composer so the user can type their reply underneath.
 *
 * A plain factory (not a hook) so it can be called after the views' early
 * returns; it touches no React state of its own.
 */
export function makeQuoteReply(opts: {
  composerRef: RefObject<MarkdownEditorHandle | null>;
  setBody: Dispatch<SetStateAction<string>>;
}): (body: string) => void {
  return (body: string) => {
    const quoted = body
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    opts.setBody((prev) =>
      prev.trim() ? `${prev.trimEnd()}\n\n${quoted}\n\n` : `${quoted}\n\n`,
    );
    opts.composerRef.current?.focus();
  };
}
