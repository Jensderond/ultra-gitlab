//! View models and async loaders that adapt `ultra_gitlab_lib::core` results
//! for the TUI.

use ultra_gitlab_lib::core::mr_actions;
use ultra_gitlab_lib::core::mr_query::{self, ReviewFilter};
use ultra_gitlab_lib::core::pipelines;
use ultra_gitlab_lib::db::pool::DbPool;
use ultra_gitlab_lib::error::AppError;
use ultra_gitlab_lib::models::{DiffFile, MergeRequest, PipelineProject, Project};
use ultra_gitlab_lib::services::gitlab_client::{GitLabJob, GitLabPipeline};

/// A row in either list view.
#[derive(Debug, Clone)]
pub struct MrRow {
    pub id: i64,
    pub iid: i64,
    pub project_name: String,
    pub title: String,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    pub approvals_count: i64,
    pub approvals_required: i64,
    pub pipeline: Option<String>,
    pub is_draft: bool,
    pub user_has_approved: bool,
    /// GitLab MR state: `opened`, `merged`, or `closed`.
    pub state: String,
    pub web_url: String,
    /// True when an auto-merge claim is active for this MR (the desktop's sync
    /// engine merges it once GitLab reports it mergeable).
    pub auto_merge: bool,
}

impl MrRow {
    pub fn is_merged(&self) -> bool {
        self.state == "merged"
    }

    /// True for open, non-draft MRs — the actionable top section of the Mine tab.
    /// Drafts and recently-merged MRs fall into the secondary section.
    pub fn is_open_work(&self) -> bool {
        self.state == "opened" && !self.is_draft
    }
}

impl From<MergeRequest> for MrRow {
    fn from(m: MergeRequest) -> Self {
        let is_draft = m.title.starts_with("Draft:") || m.title.starts_with("WIP:");
        MrRow {
            id: m.id,
            iid: m.iid,
            project_name: m.project_name,
            title: m.title,
            author: m.author_username,
            source_branch: m.source_branch,
            target_branch: m.target_branch,
            approvals_count: m.approvals_count.unwrap_or(0),
            approvals_required: m.approvals_required.unwrap_or(0),
            pipeline: m.head_pipeline_status,
            is_draft,
            user_has_approved: m.user_has_approved,
            state: m.state,
            web_url: m.web_url,
            auto_merge: false, // filled from auto_merge_claims by the loaders
        }
    }
}

/// A changed file plus its raw unified-diff text, from cache or live fetch.
#[derive(Debug, Clone)]
pub struct FileDiff {
    pub new_path: String,
    pub change_type: String,
    pub additions: i64,
    pub deletions: i64,
    pub diff_content: String,
}

impl From<DiffFile> for FileDiff {
    fn from(f: DiffFile) -> Self {
        FileDiff {
            new_path: f.new_path,
            change_type: f.change_type,
            additions: f.additions,
            deletions: f.deletions,
            diff_content: f.diff_content.unwrap_or_default(),
        }
    }
}

impl From<mr_actions::LiveDiffFile> for FileDiff {
    fn from(f: mr_actions::LiveDiffFile) -> Self {
        FileDiff {
            new_path: f.new_path,
            change_type: f.change_type,
            additions: 0,
            deletions: 0,
            diff_content: f.diff_content,
        }
    }
}

/// Full detail payload for the detail screen.
#[derive(Debug, Clone)]
pub struct DetailData {
    pub row: MrRow,
    pub files: Vec<FileDiff>,
    /// True when the diff was fetched live (cache miss).
    pub live: bool,
    /// SHAs needed to position inline comments (cache row or live version).
    pub diff_refs: Option<ultra_gitlab_lib::core::comments::DiffRefs>,
    /// `new_path`s classified as ignored/generated (lock files, `.gitattributes`
    /// linguist-generated entries, user collapse patterns). Hidden by default in
    /// the file tree, mirroring the desktop's collapse-generated behaviour.
    pub ignored: std::collections::HashSet<String>,
}

/// MR ids with an active auto-merge claim, for tagging list rows. Best-effort:
/// a read failure just leaves rows untagged.
async fn auto_merge_ids(pool: &DbPool) -> std::collections::HashSet<i64> {
    ultra_gitlab_lib::db::auto_merge::list_active_claims_with_mr(pool)
        .await
        .map(|claims| claims.into_iter().map(|c| c.mr_id).collect())
        .unwrap_or_default()
}

pub async fn load_review(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_review_mrs(pool, instance_id, ReviewFilter::default()).await?;
    let claimed = auto_merge_ids(pool).await;
    // Hide MRs the user has already approved — once reviewed, they drop off the list.
    Ok(rows
        .into_iter()
        .map(MrRow::from)
        .filter(|r| !r.user_has_approved)
        .map(|mut r| {
            r.auto_merge = claimed.contains(&r.id);
            r
        })
        .collect())
}

pub async fn load_mine(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_my_mrs(pool, instance_id, true, true).await?;
    let claimed = auto_merge_ids(pool).await;
    let mut rows: Vec<MrRow> = rows
        .into_iter()
        .map(MrRow::from)
        .map(|mut r| {
            r.auto_merge = claimed.contains(&r.id);
            r
        })
        .collect();
    // Open, non-draft MRs sort to the top (actionable); drafts and recently
    // merged drop below. Stable sort preserves the query's updated_at order
    // within each group. The list UI renders the two groups as separate boxes.
    rows.sort_by_key(|r| !r.is_open_work());
    Ok(rows)
}

/// Load an MR's detail, classifying its files as ignored/reviewable.
///
/// `instance_id` and `user_patterns` (the desktop's collapse patterns) are
/// passed in so the ignore set is computed exactly like the desktop: the
/// project's cached `.gitattributes` patterns combined with the user patterns,
/// matched against each file's `new_path`.
pub async fn load_detail(
    pool: &DbPool,
    mr_id: i64,
    instance_id: i64,
    user_patterns: &[String],
) -> Result<DetailData, AppError> {
    let detail = mr_query::get_detail(pool, mr_id).await?;
    let project_id = detail.mr.project_id;
    let mut row = MrRow::from(detail.mr);
    row.auto_merge = ultra_gitlab_lib::db::auto_merge::get_claim(pool, mr_id)
        .await
        .map(|c| c.is_some())
        .unwrap_or(false);

    let (files, live, diff_refs) = if detail.diff_files.is_empty() {
        let (live, refs) = mr_actions::get_live_diff(pool, mr_id).await?;
        let files: Vec<FileDiff> = live.into_iter().map(FileDiff::from).collect();
        (files, true, Some(refs))
    } else {
        let diff_refs = detail.diff.as_ref().map(|d| ultra_gitlab_lib::core::comments::DiffRefs {
            base_sha: d.base_sha.clone(),
            head_sha: d.head_sha.clone(),
            start_sha: d.start_sha.clone(),
        });
        let files: Vec<FileDiff> = detail.diff_files.into_iter().map(FileDiff::from).collect();
        (files, false, diff_refs)
    };

    // Combine the project's gitattributes patterns with the user's collapse
    // patterns, then classify each file's new_path — same as the desktop.
    let mut patterns = ultra_gitlab_lib::core::cached_gitattributes(pool, instance_id, project_id)
        .await
        .unwrap_or_default();
    patterns.extend(user_patterns.iter().cloned());
    let paths: Vec<String> = files.iter().map(|f| f.new_path.clone()).collect();
    let ignored = crate::filter::ignored_paths(&paths, &patterns);

    Ok(DetailData {
        row,
        files,
        live,
        diff_refs,
        ignored,
    })
}

/// Truncate a git SHA to its short 8-char form for display.
pub fn short_sha(sha: &str) -> String {
    if sha.len() > 8 {
        sha[..8].to_string()
    } else {
        sha.to_string()
    }
}

/// Latest pipeline status shown next to a project in the Projects view.
#[derive(Debug, Clone)]
pub struct PipeStatus {
    pub status: String,
    pub ref_name: String,
}

/// A tracked project row in the Pipelines tab.
#[derive(Debug, Clone)]
pub struct PipeProjectRow {
    pub project_id: i64,
    pub name: String,
    pub web_url: String,
    pub pinned: bool,
    pub status: Option<PipeStatus>,
}

/// A pipeline row (project pipelines or MR pipelines).
#[derive(Debug, Clone)]
pub struct PipeRow {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub duration: Option<i64>,
}

impl From<GitLabPipeline> for PipeRow {
    fn from(p: GitLabPipeline) -> Self {
        PipeRow {
            id: p.id,
            project_id: p.project_id,
            status: p.status,
            ref_name: p.ref_name,
            sha: short_sha(&p.sha),
            web_url: p.web_url,
            duration: p.duration,
        }
    }
}

/// A job row within a pipeline.
#[derive(Debug, Clone)]
pub struct JobRow {
    pub id: i64,
    pub name: String,
    pub stage: String,
    pub status: String,
    pub web_url: String,
    pub allow_failure: bool,
}

impl From<GitLabJob> for JobRow {
    fn from(j: GitLabJob) -> Self {
        JobRow {
            id: j.id,
            name: j.name,
            stage: j.stage,
            status: j.status,
            web_url: j.web_url,
            allow_failure: j.allow_failure,
        }
    }
}

/// A project search result in the add-project overlay.
#[derive(Debug, Clone)]
pub struct ProjectHit {
    pub id: i64,
    pub name: String,
}

fn project_row(p: PipelineProject, status: Option<PipeStatus>) -> PipeProjectRow {
    PipeProjectRow {
        project_id: p.project_id,
        name: p.name_with_namespace,
        web_url: p.web_url,
        pinned: p.pinned,
        status,
    }
}

/// Load tracked projects with their cached statuses for instant glyphs.
pub async fn load_pipeline_projects(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Vec<PipeProjectRow>, AppError> {
    let projects = pipelines::list_projects(pool, instance_id).await?;
    let ids: Vec<i64> = projects.iter().map(|p| p.project_id).collect();
    let cached = pipelines::cached_statuses(pool, instance_id, &ids).await?;
    let mut by_pid: std::collections::HashMap<i64, PipeStatus> = std::collections::HashMap::new();
    for c in cached {
        by_pid.insert(
            c.project_id,
            PipeStatus {
                status: c.status,
                ref_name: c.ref_name,
            },
        );
    }
    Ok(projects
        .into_iter()
        .map(|p| {
            let st = by_pid.remove(&p.project_id);
            project_row(p, st)
        })
        .collect())
}

/// Fetch live latest statuses for the given projects.
pub async fn load_project_statuses(
    pool: &DbPool,
    instance_id: i64,
    project_ids: Vec<i64>,
) -> Result<Vec<(i64, PipeStatus)>, AppError> {
    let live = pipelines::latest_statuses(pool, instance_id, &project_ids).await?;
    Ok(live
        .into_iter()
        .map(|p| {
            (
                p.project_id,
                PipeStatus {
                    status: p.status,
                    ref_name: p.ref_name,
                },
            )
        })
        .collect())
}

/// Recent pipelines for a project.
pub async fn load_project_pipelines(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
) -> Result<Vec<PipeRow>, AppError> {
    Ok(pipelines::project_pipelines(pool, instance_id, project_id, 20)
        .await?
        .into_iter()
        .map(PipeRow::from)
        .collect())
}

/// Jobs (and bridges) for a pipeline.
pub async fn load_pipeline_jobs(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    pipeline_id: i64,
) -> Result<Vec<JobRow>, AppError> {
    Ok(
        pipelines::pipeline_jobs(pool, instance_id, project_id, pipeline_id)
            .await?
            .into_iter()
            .map(JobRow::from)
            .collect(),
    )
}

/// Search projects to add to the dashboard.
pub async fn search_pipeline_projects(
    pool: &DbPool,
    instance_id: i64,
    query: String,
) -> Result<Vec<ProjectHit>, AppError> {
    Ok(pipelines::search_projects(pool, instance_id, &query)
        .await?
        .into_iter()
        .map(|p: Project| ProjectHit {
            id: p.id,
            name: p.name_with_namespace,
        })
        .collect())
}

/// Pipelines attached to an MR (for the detail-screen panel).
pub async fn load_mr_pipelines(pool: &DbPool, mr_id: i64) -> Result<Vec<PipeRow>, AppError> {
    Ok(pipelines::mr_pipelines(pool, mr_id)
        .await?
        .into_iter()
        .map(PipeRow::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipe_row_shortens_sha() {
        let p = ultra_gitlab_lib::services::gitlab_client::GitLabPipeline {
            id: 1,
            project_id: 10,
            status: "success".into(),
            ref_name: "main".into(),
            sha: "abcdef0123456789".into(),
            web_url: "http://x".into(),
            created_at: "2026-06-03T00:00:00Z".into(),
            updated_at: None,
            duration: Some(12),
        };
        let row = PipeRow::from(p);
        assert_eq!(row.sha, "abcdef01");
        assert_eq!(row.status, "success");
    }
}
