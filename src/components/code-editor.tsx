import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

// Follow the OS color scheme the same way the rest of the app does (main.tsx /
// DiffSurface), so the editor's theme matches light/dark without a prop.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function subscribeDark(cb: () => void) {
  darkQuery.addEventListener("change", cb);
  return () => darkQuery.removeEventListener("change", cb);
}
function useIsDark() {
  return useSyncExternalStore(
    subscribeDark,
    () => darkQuery.matches,
    () => true,
  );
}

const shellLanguage = StreamLanguage.define(shell);

/**
 * A small CodeMirror 6 editor. Defaults to shell highlighting (git hooks are
 * shell scripts); wrap it in a sized container — it fills its parent's height.
 */
export function CodeEditor({
  value,
  onChange,
  readOnly,
  className,
  wrap = false,
}: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  className?: string;
  /** Soft-wrap long lines instead of scrolling horizontally. */
  wrap?: boolean;
}) {
  const isDark = useIsDark();
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      theme={isDark ? "dark" : "light"}
      height="100%"
      extensions={
        wrap ? [shellLanguage, EditorView.lineWrapping] : [shellLanguage]
      }
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: false }}
      className={cn(
        "h-full overflow-hidden rounded-md border text-xs [&_.cm-editor]:h-full [&_.cm-focused]:outline-none",
        className,
      )}
    />
  );
}
