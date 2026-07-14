//! Resolving GitHub **bot** avatars, which the login-derived `<host>/<login>.png`
//! shortcut can't reach.
//!
//! The app derives GitHub user avatars from the login (`<host>/<login>.png`), but
//! that shortcut does not exist for bot accounts: `gh` returns bot logins as
//! `app/dependabot` (→ `github.com/app/dependabot.png` 404) and even the plain
//! `github.com/dependabot[bot].png` 404s. The real avatar is reachable only via
//! the API — `gh api users/dependabot%5Bbot%5D -q .avatar_url` →
//! `https://avatars.githubusercontent.com/in/29110?v=4` — a stable URL keyed by
//! the app's id, which isn't derivable from the login. This command resolves it
//! once per bot; the frontend caches the result and falls back to initials on any
//! failure (offline / no gh / unknown bot), so a decoration never surfaces an error.
//!
//! github.com only: `gh api users/…` targets github.com, so Enterprise bots stay
//! on the initials fallback.

use crate::error::AppResult;
use crate::github::runner::{run_gh_raw, GH_TIMEOUT};

/// The bare bot name for a bot login, or `None` if `login` isn't a valid bot
/// handle. Accepts three shapes gh emits or callers hold — `app/<name>`,
/// `<name>[bot]`, or a bare `<name>` — strips the `app/` prefix and any `[bot]`
/// suffix, and requires the remaining name to match GitHub's username grammar
/// `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. That grammar check is the security gate:
/// the name goes into a process argument, so a leading `-` (flag injection), a
/// slash, or brackets must be rejected.
fn normalize_bot_login(login: &str) -> Option<String> {
    let trimmed = login.trim();
    // Strip the `app/` owner prefix gh emits for bot logins, then the `[bot]`
    // suffix if present. Either shape (or a bare name) is accepted.
    let name = trimmed.strip_prefix("app/").unwrap_or(trimmed);
    let name = name.strip_suffix("[bot]").unwrap_or(name);
    if is_valid_username(name) {
        Some(name.to_string())
    } else {
        None
    }
}

/// GitHub's username grammar: a leading alphanumeric then up to 38 more
/// alphanumerics-or-hyphens (39 chars total). Rejects empty, over-long, a
/// leading `-`, and any other character (slash, brackets, `.`).
fn is_valid_username(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_alphanumeric() {
        return false;
    }
    name.len() <= 39 && chars.all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Whether a resolved avatar URL is a plain https URL on a host we trust to load
/// under the null CSP — `avatars.githubusercontent.com` (and its subdomains) or
/// `github.com`. The `.avatar_url` value comes from untrusted JSON, so an
/// attacker-shaped host must not reach an `<img src>`.
fn is_trusted_avatar_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    // The host is everything up to the first `/`, `?`, or `#`.
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    host == "github.com"
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

/// The real avatar URL for a GitHub bot account (dependabot, renovate,
/// github-actions, …), or `""` when it can't be resolved (invalid login,
/// unknown bot, offline, or no gh). Read-only and repo-independent — the
/// `users/<name>[bot]` API is global, so no repo dir is passed. Never errors on
/// a lookup miss: an empty string tells the caller to fall back to initials, and
/// a decoration must not raise a toast.
#[tauri::command]
pub async fn gh_bot_avatar(login: String) -> AppResult<String> {
    // Normalize + grammar-validate FIRST — the name goes into a process arg.
    let Some(name) = normalize_bot_login(&login) else {
        return Ok(String::new());
    };
    // Percent-encoded brackets (`%5B`/`%5D`) — verified live that gh resolves
    // `users/dependabot%5Bbot%5D`; literal brackets are shell-fragile.
    let path = format!("users/{name}%5Bbot%5D");
    let args = ["api", &path, "-q", ".avatar_url"];
    // `run_gh_raw` never turns a 404 (unknown bot) into an error; a missing gh or
    // timeout does return Err, which we swallow to "" — decorations never toast.
    let out = match run_gh_raw(None, &args, GH_TIMEOUT).await {
        Ok(out) => out,
        Err(_) => return Ok(String::new()),
    };
    if out.code != 0 {
        return Ok(String::new());
    }
    let url = out.stdout_lossy().trim().to_string();
    if is_trusted_avatar_url(&url) {
        Ok(url)
    } else {
        // Empty, a null (`gh -q` prints nothing), or an untrusted host → no avatar.
        Ok(String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::{is_trusted_avatar_url, normalize_bot_login};

    #[test]
    fn normalize_accepts_the_three_bot_login_shapes() {
        assert_eq!(normalize_bot_login("app/dependabot").as_deref(), Some("dependabot"));
        assert_eq!(normalize_bot_login("dependabot[bot]").as_deref(), Some("dependabot"));
        assert_eq!(normalize_bot_login("dependabot").as_deref(), Some("dependabot"));
        // Both prefix and suffix together.
        assert_eq!(normalize_bot_login("app/renovate[bot]").as_deref(), Some("renovate"));
        // Hyphens are valid mid-name (github-actions).
        assert_eq!(
            normalize_bot_login("github-actions[bot]").as_deref(),
            Some("github-actions")
        );
        // Surrounding whitespace is trimmed.
        assert_eq!(normalize_bot_login("  dependabot[bot]  ").as_deref(), Some("dependabot"));
    }

    #[test]
    fn normalize_rejects_invalid_names() {
        // A leading hyphen (flag-injection guard).
        assert_eq!(normalize_bot_login("-evil"), None);
        assert_eq!(normalize_bot_login("app/-evil[bot]"), None);
        // A slash inside the name (path traversal / extra API segments).
        assert_eq!(normalize_bot_login("foo/bar"), None);
        // Empty / whitespace only.
        assert_eq!(normalize_bot_login(""), None);
        assert_eq!(normalize_bot_login("   "), None);
        assert_eq!(normalize_bot_login("app/"), None);
        assert_eq!(normalize_bot_login("[bot]"), None);
        // Over-long (>39 chars after stripping).
        assert_eq!(normalize_bot_login(&"a".repeat(40)), None);
        // 39 is the boundary and allowed.
        assert_eq!(normalize_bot_login(&"a".repeat(39)).as_deref(), Some("a".repeat(39).as_str()));
    }

    #[test]
    fn trusted_url_gate_accepts_only_https_github_hosts() {
        assert!(is_trusted_avatar_url("https://avatars.githubusercontent.com/in/29110?v=4"));
        assert!(is_trusted_avatar_url("https://github.com/dependabot.png?size=48"));
        assert!(is_trusted_avatar_url("https://githubusercontent.com/x"));
        // Wrong scheme.
        assert!(!is_trusted_avatar_url("http://avatars.githubusercontent.com/in/1"));
        // Look-alike / attacker host (suffix without the dot boundary).
        assert!(!is_trusted_avatar_url("https://evilgithubusercontent.com/x"));
        assert!(!is_trusted_avatar_url("https://github.com.evil.com/x"));
        assert!(!is_trusted_avatar_url("https://evil.com/x"));
        // Empty.
        assert!(!is_trusted_avatar_url(""));
    }
}
