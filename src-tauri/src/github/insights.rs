use serde::Serialize;

use crate::error::AppResult;
use crate::github::runner::{run_gh_raw, GH_TIMEOUT};

/// Community-health profile + social counts for the Insights tab. Read-only and
/// tolerant: a repo without a GitHub remote (or with the dependency/community
/// data unavailable) reads as a zeroed default rather than erroring — the same
/// posture as `gh_repo_admin`. The caller should still gate on having a GitHub
/// repo so an all-zero default isn't shown for a non-GitHub project.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityInsights {
    /// 0–100 community-health score from GitHub's community/profile endpoint.
    pub health_percentage: u32,
    pub has_readme: bool,
    pub has_license: bool,
    pub has_code_of_conduct: bool,
    pub has_contributing: bool,
    pub has_issue_template: bool,
    pub has_pull_request_template: bool,
    /// SPDX-ish license name, when one is detected.
    pub license: Option<String>,
    pub forks_count: u32,
    pub stargazers_count: u32,
    /// Real "watchers" (subscribers) — NOT the legacy `watchers_count` that just
    /// mirrors stars.
    pub watchers_count: u32,
    pub open_issues_count: u32,
}

#[tauri::command]
pub async fn gh_community_insights(repo_path: String) -> AppResult<CommunityInsights> {
    let mut out = CommunityInsights::default();

    // Community profile: health score + which health files are present.
    let profile = run_gh_raw(
        Some(&repo_path),
        &["api", "repos/{owner}/{repo}/community/profile"],
        GH_TIMEOUT,
    )
    .await?;
    if profile.code == 0 {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&profile.stdout_lossy()) {
            out.health_percentage = v["health_percentage"].as_u64().unwrap_or(0) as u32;
            let files = &v["files"];
            let present = |k: &str| !files[k].is_null();
            out.has_readme = present("readme");
            out.has_license = present("license");
            out.has_code_of_conduct = present("code_of_conduct");
            out.has_contributing = present("contributing");
            out.has_issue_template = present("issue_template");
            out.has_pull_request_template = present("pull_request_template");
            out.license = files["license"]["name"].as_str().map(str::to_string);
        }
    }

    // Repo object: social counts.
    let repo = run_gh_raw(
        Some(&repo_path),
        &["api", "repos/{owner}/{repo}"],
        GH_TIMEOUT,
    )
    .await?;
    if repo.code == 0 {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&repo.stdout_lossy()) {
            out.forks_count = v["forks_count"].as_u64().unwrap_or(0) as u32;
            out.stargazers_count = v["stargazers_count"].as_u64().unwrap_or(0) as u32;
            out.watchers_count = v["subscribers_count"].as_u64().unwrap_or(0) as u32;
            out.open_issues_count = v["open_issues_count"].as_u64().unwrap_or(0) as u32;
        }
    }

    Ok(out)
}
