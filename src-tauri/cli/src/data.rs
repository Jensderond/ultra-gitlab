//! View models and async loaders that adapt `ultra_gitlab_lib::core` results
//! for the TUI.

use ultra_gitlab_lib::core::mr_actions;
use ultra_gitlab_lib::core::mr_query::{self, ReviewFilter};
use ultra_gitlab_lib::db::pool::DbPool;
use ultra_gitlab_lib::error::AppError;
use ultra_gitlab_lib::models::{DiffFile, MergeRequest};

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
}

pub async fn load_review(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_review_mrs(pool, instance_id, ReviewFilter::default()).await?;
    Ok(rows.into_iter().map(MrRow::from).collect())
}

pub async fn load_mine(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_my_mrs(pool, instance_id, true, true).await?;
    Ok(rows.into_iter().map(MrRow::from).collect())
}

pub async fn load_detail(pool: &DbPool, mr_id: i64) -> Result<DetailData, AppError> {
    let detail = mr_query::get_detail(pool, mr_id).await?;
    let row = MrRow::from(detail.mr);
    if detail.diff_files.is_empty() {
        // Cache miss — fetch live, in-memory only.
        let live = mr_actions::get_live_diff(pool, mr_id).await?;
        Ok(DetailData {
            row,
            files: live.into_iter().map(FileDiff::from).collect(),
            live: true,
        })
    } else {
        Ok(DetailData {
            row,
            files: detail.diff_files.into_iter().map(FileDiff::from).collect(),
            live: false,
        })
    }
}
