import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";

/**
 * A description editor with GitHub-style Write/Preview tabs. Preview renders
 * through the same Markdown component PR bodies use, so what you see is what
 * the conversation view will show. `actions` renders on the right of the tab
 * row (e.g. an AI Generate button).
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder,
  rows = 7,
  disabled,
  textareaClassName,
  actions,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  textareaClassName?: string;
  actions?: ReactNode;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={mode === "write" ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={mode === "write"}
          onClick={() => setMode("write")}
        >
          Write
        </Button>
        <Button
          type="button"
          variant={mode === "preview" ? "secondary" : "ghost"}
          size="xs"
          aria-pressed={mode === "preview"}
          onClick={() => setMode("preview")}
        >
          Preview
        </Button>
        {actions && (
          <>
            <span className="flex-1" />
            {actions}
          </>
        )}
      </div>
      {mode === "write" ? (
        <Textarea
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          disabled={disabled}
          className={textareaClassName}
        />
      ) : (
        <div className="max-h-72 min-h-24 overflow-y-auto border border-input px-3 py-2">
          {value.trim() ? (
            <Markdown>{value}</Markdown>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
