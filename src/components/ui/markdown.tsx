import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import { Marked } from "marked";
import { useMemo } from "react";
import { diffLang } from "@/features/diff/diff-lang";
import { cn } from "@/lib/utils";
import "./markdown-highlight.css";

/**
 * Resolve a fenced code block's info string to a highlight.js language id, or
 * null to render it as plain text. highlight.js resolves its own aliases
 * (`js`, `ts`, `py`, `sh`, `yml`…); if that misses, we treat the tag as a file
 * extension and reuse the diff's extension→language map (so `rs` → rust etc.).
 */
function resolveCodeLang(info: string | undefined): string | null {
  if (!info) return null;
  const tag = info.trim().toLowerCase().split(/\s+/)[0];
  if (!tag) return null;
  if (hljs.getLanguage(tag)) return tag;
  const mapped = diffLang(`f.${tag}`);
  return mapped && hljs.getLanguage(mapped) ? mapped : null;
}

/**
 * A marked instance whose code renderer syntax-highlights fenced blocks with
 * highlight.js (the full ~190-language build). Tokens are emitted as
 * `hljs-*`-classed spans, colored by the GitHub palette in
 * `markdown-highlight.css` (scoped to `.markdown-body`). Untagged or unknown
 * languages return `false` so marked falls back to its default escaped block.
 */
const md = new Marked({ gfm: true });
md.use({
  renderer: {
    code({ text, lang }) {
      const language = resolveCodeLang(lang);
      if (!language) return false;
      const { value } = hljs.highlight(text, {
        language,
        ignoreIllegals: true,
      });
      return `<pre><code class="hljs language-${language}">${value}</code></pre>`;
    },
  },
});

/**
 * Renders GitHub-flavored Markdown (PR descriptions, comments, AI output).
 *
 * GitHub comments routinely embed raw HTML — Dependabot and netlify use
 * <details>/<summary>, tables, and <img> badges — so we render through marked
 * (markdown → HTML) and sanitize with DOMPurify before injecting. Fenced code
 * blocks are syntax-highlighted with highlight.js (see `md` above).
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
    const raw = md.parse(children, { async: false }) as string;
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
        "markdown-body text-xs/relaxed break-words",
        // Margins collapse at the edges so previews/comments have no leading or
        // trailing gap (matches GitHub's rendered-markdown reset).
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Heading scale with GitHub-style underlines on h1/h2 for clear hierarchy.
        "[&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:border-b [&_h1]:border-border [&_h1]:pb-1.5 [&_h1]:font-heading [&_h1]:text-xl [&_h1]:font-semibold",
        "[&_h2]:mt-5 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1.5 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold",
        "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-heading [&_h3]:text-base [&_h3]:font-semibold",
        "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-heading [&_h4]:text-sm [&_h4]:font-semibold",
        "[&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:font-heading [&_h5]:text-xs [&_h5]:font-semibold",
        "[&_h6]:mt-4 [&_h6]:mb-2 [&_h6]:font-heading [&_h6]:text-xs [&_h6]:font-semibold [&_h6]:text-muted-foreground",
        "[&_p]:my-2.5 [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        // Nested lists hug their parent item rather than opening a full gap.
        "[&_li_ul]:my-1 [&_li_ol]:my-1",
        "[&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-foreground",
        "[&_code]:rounded-none [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-2.5 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-[0.85em] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[1em]",
        "[&_blockquote]:my-2.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-4 [&_hr]:border-border [&_strong]:font-semibold [&_em]:italic",
        "[&_table]:my-2.5 [&_table]:block [&_table]:overflow-x-auto [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5",
        // Task lists (`- [ ]`) render as checkboxes with no bullet, like GitHub.
        "[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle [&_li:has(input[type=checkbox])]:list-none [&_li:has(input[type=checkbox])]:-ml-5",
        // Collapsible details blocks (release notes, changelogs, command lists)
        "[&_details]:my-2.5 [&_summary]:cursor-pointer [&_summary]:py-1 [&_summary]:font-medium [&_summary]:select-none",
        // Inline badges (compatibility score) and embedded previews (QR codes)
        "[&_img]:my-1 [&_img]:inline-block [&_img]:max-w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
