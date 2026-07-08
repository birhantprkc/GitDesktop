/**
 * The single source of truth for the AI-review comment body convention. Both
 * posting seams — the manual `PrReviewPanel` and the automations `runner` —
 * MUST build their comment bodies through {@link buildAiCommentBody} so a
 * posted AI review is unmistakably machine-authored and byte-identical across
 * both paths. Do not hand-roll the header/footer in either seam again.
 *
 * The output is pure Markdown: it renders on every forge (GitHub / GitLab /
 * Bitbucket) AND in the app's own `Markdown` component, so it uses no raw HTML
 * and no `<details>`.
 */
export interface AiCommentParts {
  kind: "review" | "security audit";
  model: string;
  automated: boolean;
  text: string;
}

/**
 * The domain link every GitDesktop-authored comment carries in its footer — the
 * stable anchor by which the app recognizes its OWN comments on a PR later (both
 * this AI-review footer and the MCP agent footer embed it; their wording differs,
 * so detection keys off this URL, never the phrasing). Keep it a bare string so a
 * simple `body.includes(GD_COMMENT_ANCHOR)` is the whole test.
 */
export const GD_COMMENT_ANCHOR = "https://gitdesktop.app";

/** Wraps raw AI review text in the branded GitDesktop AI-comment body. */
export function buildAiCommentBody({
  kind,
  model,
  automated,
  text,
}: AiCommentParts): string {
  const meta = automated ? " · automated" : "";
  return `🤖 **GitDesktop AI ${kind}** · \`${model}\`${meta}\n\n---\n\n${text}\n\n---\n\n_Posted by [GitDesktop](${GD_COMMENT_ANCHOR}) — AI output, verify before acting on it._`;
}
