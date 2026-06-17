import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders GitHub-flavored Markdown (PR descriptions, comments, AI output).
 *
 * GitHub comments routinely embed raw HTML — Dependabot and netlify use
 * <details>/<summary>, tables, and <img> badges — so we render through marked
 * (markdown → HTML) and sanitize with DOMPurify before injecting. Both are
 * zero-dependency, which avoids pulling a separate HTML parser just for this.
 *
 * Links open in the system browser instead of navigating the webview.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const html = useMemo(() => {
    const raw = marked.parse(children, { gfm: true, async: false }) as string;
    return DOMPurify.sanitize(raw);
  }, [children]);

  // Intercept link clicks (event delegation) so they open externally rather
  // than navigating the embedded webview.
  function onClick(e: React.MouseEvent) {
    const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
    if (href && /^(https?:|mailto:)/.test(href)) {
      e.preventDefault();
      openUrl(href);
    }
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        "text-xs/relaxed break-words",
        "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-heading [&_h1]:text-sm [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-heading [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-heading [&_h3]:font-semibold",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground",
        "[&_code]:rounded-none [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-3 [&_hr]:border-border [&_strong]:font-semibold",
        "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1",
        // Collapsible details blocks (release notes, changelogs, command lists)
        "[&_details]:my-2 [&_summary]:cursor-pointer [&_summary]:py-1 [&_summary]:font-medium [&_summary]:select-none",
        // Inline badges (compatibility score) and embedded previews (QR codes)
        "[&_img]:my-1 [&_img]:inline-block [&_img]:max-w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
