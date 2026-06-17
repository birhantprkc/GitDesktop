const WIN_PATH_RE = /[A-Za-z]:[/\\][^\s,;)'"]+/g;
const POSIX_PATH_RE = /(?:\/Users\/|\/home\/|\/root\/|\/var\/)[^\s,;)'"]+/g;
const SECRET_RE = /\b(?:sk-|ghp_|github_pat_|[A-Za-z0-9+/]{32,}={0,2})\S*/g;
// Cap length and collapse whitespace: error messages can wrap raw git stderr
// (conflict bodies, hook output) that may contain code — keep just the gist.
const MAX_LEN = 300;

/** Strip absolute paths (Win + POSIX home), secret-shaped strings, and long
 *  base64 blobs from an error message, then collapse and cap it, before
 *  sending it to PostHog. */
export function scrubErrorMessage(msg: string): string {
  return msg
    .replace(WIN_PATH_RE, "<path>")
    .replace(POSIX_PATH_RE, "<path>")
    .replace(SECRET_RE, "<redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN);
}

export function scrubError(err: unknown): {
  message: string;
  kind: string;
} {
  if (err instanceof Error) {
    return {
      message: scrubErrorMessage(err.message),
      kind: err.name || "Error",
    };
  }
  if (typeof err === "string") {
    return { message: scrubErrorMessage(err), kind: "string" };
  }
  return { message: "unknown error", kind: "unknown" };
}
