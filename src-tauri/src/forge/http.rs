//! Bitbucket-only HTTP layer (per `docs/multi-provider-support.md` §0 decision 1:
//! GitHub stays on `gh`, GitLab on `glab`, and Bitbucket Cloud speaks direct HTTP).
//!
//! This is the credential + transport substrate the [`bitbucket`](super::bitbucket)
//! provider builds on: a shared [`reqwest`](tauri_plugin_http::reqwest) client, the
//! keyring-backed credential loading, and the JSON/raw GET helpers with Bitbucket's
//! error-envelope parsing. All calls authenticate with HTTP Basic
//! (`{atlassian_account_email}:{api_token}`) — app passwords are dead (removed
//! 2026-07-28), so the API token is the only supported credential.

use std::sync::OnceLock;
use std::time::Duration;

use serde::Deserialize;
use tauri_plugin_http::reqwest::{self, Client};

use crate::error::{AppError, AppResult};

/// The Bitbucket Cloud REST base. Every relative path the provider passes is
/// resolved against this; absolute URLs (e.g. a pagination `next`) are used as-is.
pub const BB_API_BASE: &str = "https://api.bitbucket.org/2.0/";

/// The host these credentials are namespaced under in the keyring (`forge/<host>/…`).
pub const BB_HOST: &str = "bitbucket.org";

/// Keyring credential keys under `forge/bitbucket.org/*`.
pub const KEY_EMAIL: &str = "email";
pub const KEY_TOKEN: &str = "token";
pub const KEY_USERNAME: &str = "username";

/// Mirror `GLAB_NETWORK_TIMEOUT` — the ceiling for a single request.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// A tighter connect timeout so an unreachable host fails fast, not after 120s.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// The process-wide Bitbucket HTTP client. Built once (connection pooling, one TLS
/// setup) and shared across all calls.
///
/// Redirect policy is reqwest's DEFAULT, and that default is LOAD-BEARING here:
///  - PR `/diff` 302-redirects to a raw-diff URL on the SAME host — reqwest keeps
///    the `Authorization` header across a same-host redirect, so the follow-up is
///    still authenticated.
///  - Step logs 307-redirect to a pre-signed S3 URL on a DIFFERENT host — reqwest
///    STRIPS `Authorization` on a cross-host redirect (the pre-signed URL carries
///    its own auth in the query string), which is exactly what we want; sending our
///    Basic creds to S3 would be both wrong and a credential leak.
///
/// Do not override the redirect policy without preserving both behaviours.
static CLIENT: OnceLock<Client> = OnceLock::new();

fn client() -> &'static Client {
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent(concat!("GitDesktop/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            // The builder only fails on a broken TLS backend — unrecoverable, and
            // a plain `Client::new()` uses the same backend, so fall back to it
            // rather than panic on a machine we can't do anything about anyway.
            .unwrap_or_else(|_| Client::new())
    })
}

/// The stored Bitbucket credentials (email + token), loaded from the OS keyring.
/// Never logged, never returned across IPC.
pub struct BbCredentials {
    pub email: String,
    pub token: String,
}

/// Load the stored credentials from the keyring (blocking keyring reads run on a
/// blocking thread). `BitbucketNotConfigured` when no token is stored — the signal
/// the read commands turn into the "connect an account" state.
pub async fn load_credentials() -> AppResult<BbCredentials> {
    let (email, token) = tauri::async_runtime::spawn_blocking(|| {
        let email = crate::secrets::read_forge_secret(BB_HOST, KEY_EMAIL)?;
        let token = crate::secrets::read_forge_secret(BB_HOST, KEY_TOKEN)?;
        Ok::<_, AppError>((email, token))
    })
    .await
    .map_err(|e| AppError::Bitbucket(format!("keyring task failed: {e}")))??;
    match (email, token) {
        (Some(email), Some(token)) if !email.is_empty() && !token.is_empty() => {
            Ok(BbCredentials { email, token })
        }
        _ => Err(AppError::BitbucketNotConfigured),
    }
}

/// Bitbucket's error envelope (`{"type":"error","error":{"message":…}}`). Not every
/// endpoint emits it — some send plain text — so parsing is best-effort and callers
/// fall back to a status-code message.
#[derive(Deserialize)]
struct BbErrorEnvelope {
    error: Option<BbErrorBody>,
}

#[derive(Deserialize)]
struct BbErrorBody {
    #[serde(default)]
    message: String,
}

/// Turn a non-2xx response body + status into an [`AppError::Bitbucket`], with the
/// 401 / 429 special-casing the provider contract requires. `body` is the raw
/// response text (never logged elsewhere — it may echo request context, but never
/// our credentials, which live only in the request header). Exposed to the provider
/// so a caller that inspects the status itself (e.g. [`bb_get_text_status`]) can
/// still produce the identical error for statuses it doesn't special-case.
pub(crate) fn http_error(status: u16, body: &str) -> AppError {
    // Prefer the API's own message when the body is the JSON error envelope.
    let api_msg = serde_json::from_str::<BbErrorEnvelope>(body)
        .ok()
        .and_then(|e| e.error)
        .map(|e| e.message)
        .filter(|m| !m.trim().is_empty());
    match status {
        401 => AppError::Bitbucket(
            "Bitbucket rejected the request (401) — your API token may be expired or \
             revoked. Reconnect it in Settings → Accounts."
                .into(),
        ),
        429 => AppError::Bitbucket(
            "Bitbucket rate limit reached (429). Wait a moment and try again.".into(),
        ),
        _ => {
            let detail = api_msg.unwrap_or_else(|| {
                let trimmed = body.trim();
                if trimmed.is_empty() {
                    format!("HTTP {status}")
                } else {
                    // Plain-text (non-envelope) body — keep it short.
                    let snippet: String = trimmed.chars().take(300).collect();
                    format!("HTTP {status}: {snippet}")
                }
            });
            AppError::Bitbucket(detail)
        }
    }
}

/// Resolve a relative path against the API base, or pass an absolute URL through.
/// (Bitbucket's pagination `next` is a full URL; single-endpoint calls pass a
/// relative path like `workspaces` or `repositories/{ws}`.)
fn resolve_url(path_or_url: &str) -> String {
    if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
        path_or_url.to_string()
    } else {
        format!("{BB_API_BASE}{}", path_or_url.trim_start_matches('/'))
    }
}

/// GET a Bitbucket endpoint and return the raw `(status, body)` — following
/// redirects (the default policy — see [`CLIENT`]) — WITHOUT turning a non-2xx into
/// an error. Only a transport/read failure is an `Err`; the HTTP status is handed to
/// the caller so it can special-case one (e.g. a 404 from an expired pipeline log).
/// Callers that don't need that use [`bb_get_text`].
pub async fn bb_get_text_status(
    creds: &BbCredentials,
    path_or_url: &str,
) -> AppResult<(u16, String)> {
    let url = resolve_url(path_or_url);
    let resp = client()
        .get(&url)
        .basic_auth(&creds.email, Some(&creds.token))
        .send()
        .await
        .map_err(|e| AppError::Bitbucket(format!("Bitbucket request failed: {e}")))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Bitbucket(format!("could not read Bitbucket response: {e}")))?;
    Ok((status, body))
}

/// GET a Bitbucket endpoint and return the raw response body as text, following
/// redirects (the default policy — see [`CLIENT`]). Non-2xx → [`http_error`]. Used
/// for the PR `/diff` (raw unified diff) and step logs (raw octet-stream).
pub async fn bb_get_text(creds: &BbCredentials, path_or_url: &str) -> AppResult<String> {
    let (status, body) = bb_get_text_status(creds, path_or_url).await?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, &body));
    }
    Ok(body)
}

/// GET a Bitbucket endpoint expecting JSON, deserializing into `T`. `Accept:
/// application/json`, HTTP Basic auth, default redirect policy. Non-2xx →
/// [`http_error`] (with the error-envelope parse); a parse failure of a 2xx body →
/// `Bitbucket("could not parse …")` carrying the underlying serde error (never
/// mapped into a specific-cause message).
pub async fn bb_get_json<T: serde::de::DeserializeOwned>(
    creds: &BbCredentials,
    path_or_url: &str,
    what: &str,
) -> AppResult<T> {
    let url = resolve_url(path_or_url);
    let resp = client()
        .get(&url)
        .basic_auth(&creds.email, Some(&creds.token))
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| AppError::Bitbucket(format!("Bitbucket request failed: {e}")))?;
    let status = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::Bitbucket(format!("could not read Bitbucket response: {e}")))?;
    if !(200..300).contains(&status) {
        return Err(http_error(status, &body));
    }
    serde_json::from_str(&body)
        .map_err(|e| AppError::Bitbucket(format!("could not parse Bitbucket {what}: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_url_joins_relative_and_passes_absolute() {
        assert_eq!(
            resolve_url("workspaces"),
            "https://api.bitbucket.org/2.0/workspaces"
        );
        // A leading slash on the relative path is tolerated (not doubled).
        assert_eq!(
            resolve_url("/repositories/ws"),
            "https://api.bitbucket.org/2.0/repositories/ws"
        );
        // An absolute URL (a pagination `next`) is passed through untouched.
        let next = "https://api.bitbucket.org/2.0/repositories/ws?page=2";
        assert_eq!(resolve_url(next), next);
    }

    #[test]
    fn http_error_prefers_the_api_envelope_message() {
        let body = r#"{"type":"error","error":{"message":"Repository not found"}}"#;
        match http_error(404, body) {
            AppError::Bitbucket(m) => assert!(m.contains("Repository not found")),
            other => panic!("expected Bitbucket error, got {other:?}"),
        }
    }

    #[test]
    fn http_error_falls_back_to_plain_text_body() {
        match http_error(500, "upstream boom") {
            AppError::Bitbucket(m) => {
                assert!(m.contains("500"));
                assert!(m.contains("upstream boom"));
            }
            other => panic!("expected Bitbucket error, got {other:?}"),
        }
    }

    #[test]
    fn http_error_special_cases_401_and_429() {
        match http_error(401, "") {
            AppError::Bitbucket(m) => assert!(m.contains("token") && m.contains("401")),
            other => panic!("expected Bitbucket error, got {other:?}"),
        }
        match http_error(429, "") {
            AppError::Bitbucket(m) => assert!(m.to_lowercase().contains("rate limit")),
            other => panic!("expected Bitbucket error, got {other:?}"),
        }
    }
}
