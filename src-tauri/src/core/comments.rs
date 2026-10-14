//! Comment logic shared between the Tauri commands and the `ultra` CLI.
//!
//! Pure helpers (suggestion blocks, diff line resolution) are unit-tested here.
//! Direct-API operations post straight to GitLab; the CLI uses them because it
//! has no background sync engine.

/// Number of lines above/below the suggestion anchor that the replacement spans.
/// Mirrors the desktop `buildGitLabSuggestionBlock` math in
/// `src/utils/gitlabSuggestions.ts`.
pub fn suggestion_offsets(start_line: i64, end_line: i64, anchor_line: i64) -> (i64, i64) {
    let above = (anchor_line - start_line).max(0);
    let below = (end_line - anchor_line).max(0);
    (above, below)
}

/// Build a GitLab ```suggestion fenced block replacing `above` lines before and
/// `below` lines after the anchored line with `replacement` (no trailing newline
/// inside the fence is added beyond the one separating content from the fence).
pub fn build_suggestion_block(replacement: &str, above: i64, below: i64) -> String {
    format!("```suggestion:-{above}+{below}\n{replacement}\n```\n")
}

/// Resolve context line numbers from a unified diff.
///
/// Given a line number on one side, find the corresponding line on the other
/// side by parsing the unified diff hunk headers and counting lines. Returns
/// `(old_line, new_line)`. Ported verbatim from the desktop comment command so
/// both paths share one implementation.
pub fn resolve_context_lines(
    diff_content: &str,
    known_line: i64,
    is_old_side: bool,
) -> Option<(i64, i64)> {
    let mut old_line: i64 = 0;
    let mut new_line: i64 = 0;

    for line in diff_content.lines() {
        if line.starts_with("@@") {
            let parts: Vec<&str> = line.splitn(4, ' ').collect();
            if parts.len() >= 3 {
                if let Some(old_start) = parts[1].strip_prefix('-') {
                    old_line = old_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1;
                }
                if let Some(new_start) = parts[2].strip_prefix('+') {
                    new_line = new_start
                        .split(',')
                        .next()
                        .and_then(|s| s.parse::<i64>().ok())
                        .unwrap_or(0)
                        - 1;
                }
            }
            continue;
        }

        if line.starts_with("---")
            || line.starts_with("+++")
            || line.starts_with("diff ")
            || line.starts_with("index ")
        {
            continue;
        }

        if line.starts_with('-') {
            old_line += 1;
        } else if line.starts_with('+') {
            new_line += 1;
        } else {
            old_line += 1;
            new_line += 1;
            let target_matches = if is_old_side {
                old_line == known_line
            } else {
                new_line == known_line
            };
            if target_matches {
                return Some((old_line, new_line));
            }
        }
    }
    None
}

/// What a diff line is, from the merge request's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiffLineKind {
    Added,
    Removed,
    Context,
}

/// A line located in a unified diff, with GitLab's position counters.
///
/// `old_pos`/`new_pos` follow GitLab's diff parser: an added line still
/// carries the old-side counter it sits at (and a removed line the new-side
/// one). Both go into the line code that anchors a multi-line comment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DiffLinePosition {
    pub kind: DiffLineKind,
    pub old_pos: i64,
    pub new_pos: i64,
}

/// Find `line` (on the old or new side) in a unified diff.
pub fn diff_line_position(diff_content: &str, line: i64, is_old_side: bool) -> Option<DiffLinePosition> {
    let mut old_pos: i64 = 0;
    let mut new_pos: i64 = 0;
    let mut in_hunk = false;

    for raw in diff_content.lines() {
        if raw.starts_with("@@") {
            let parts: Vec<&str> = raw.splitn(4, ' ').collect();
            let start = |s: Option<&&str>, prefix: char| {
                s.and_then(|p| p.strip_prefix(prefix))
                    .and_then(|p| p.split(',').next())
                    .and_then(|n| n.parse::<i64>().ok())
            };
            old_pos = start(parts.get(1), '-').unwrap_or(0);
            new_pos = start(parts.get(2), '+').unwrap_or(0);
            in_hunk = true;
            continue;
        }
        if !in_hunk {
            // File headers (diff/index/---/+++) before the first hunk.
            continue;
        }
        let (kind, hit) = match raw.as_bytes().first() {
            Some(b'+') => (DiffLineKind::Added, !is_old_side && new_pos == line),
            Some(b'-') => (DiffLineKind::Removed, is_old_side && old_pos == line),
            // "\ No newline at end of file" isn't a line of either version.
            Some(b'\\') => continue,
            _ => (
                DiffLineKind::Context,
                if is_old_side { old_pos == line } else { new_pos == line },
            ),
        };
        if hit {
            return Some(DiffLinePosition { kind, old_pos, new_pos });
        }
        match kind {
            DiffLineKind::Added => new_pos += 1,
            DiffLineKind::Removed => old_pos += 1,
            DiffLineKind::Context => {
                old_pos += 1;
                new_pos += 1;
            }
        }
    }
    None
}

/// GitLab's line code: `<sha1 of the file path>_<old_pos>_<new_pos>`.
pub fn line_code(file_path: &str, old_pos: i64, new_pos: i64) -> String {
    use sha1::{Digest, Sha1};
    let digest = Sha1::digest(file_path.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("{hex}_{old_pos}_{new_pos}")
}

/// One end of a `position[line_range]`, as GitLab's API expects it.
fn line_range_point(file_path: &str, pos: DiffLinePosition) -> serde_json::Value {
    let mut point = serde_json::json!({ "line_code": line_code(file_path, pos.old_pos, pos.new_pos) });
    match pos.kind {
        DiffLineKind::Added => {
            point["type"] = "new".into();
            point["new_line"] = pos.new_pos.into();
        }
        DiffLineKind::Removed => {
            point["type"] = "old".into();
            point["old_line"] = pos.old_pos.into();
        }
        DiffLineKind::Context => {
            point["old_line"] = pos.old_pos.into();
            point["new_line"] = pos.new_pos.into();
        }
    }
    point
}

/// Build GitLab's `line_range` for a comment spanning `start` to `end`, each
/// given as `(line, is_old_side)`. `None` when either end isn't in the diff,
/// in which case the comment is posted on the end line alone.
pub fn build_line_range(
    diff_content: &str,
    file_path: &str,
    start: (i64, bool),
    end: (i64, bool),
) -> Option<serde_json::Value> {
    let s = diff_line_position(diff_content, start.0, start.1)?;
    let e = diff_line_position(diff_content, end.0, end.1)?;
    if s == e {
        return None;
    }
    Some(serde_json::json!({
        "start": line_range_point(file_path, s),
        "end": line_range_point(file_path, e),
    }))
}

use crate::core::create_client;
use crate::core::mr_actions::mr_api_ids;
use crate::db::pool::DbPool;
use crate::error::AppError;

/// The three SHAs GitLab needs to position an inline note.
#[derive(Debug, Clone)]
pub struct DiffRefs {
    pub base_sha: String,
    pub head_sha: String,
    pub start_sha: String,
}

/// One discussion thread for the CLI overlay.
#[derive(Debug, Clone)]
pub struct Thread {
    pub id: String,
    pub resolvable: bool,
    pub resolved: bool,
    /// Present for inline threads.
    pub file_path: Option<String>,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub notes: Vec<ThreadNote>,
}

/// One note within a thread.
#[derive(Debug, Clone)]
pub struct ThreadNote {
    pub author: String,
    pub body: String,
    pub system: bool,
}

/// Read cached diff SHAs for an MR from the `diffs` table. Returns `None` when
/// the MR has no cached diff (e.g. a live-only detail), in which case the caller
/// supplies refs from the live API version instead.
pub async fn diff_refs_from_cache(pool: &DbPool, mr_id: i64) -> Result<Option<DiffRefs>, AppError> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT base_sha, head_sha, start_sha FROM diffs WHERE mr_id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(base_sha, head_sha, start_sha)| DiffRefs {
        base_sha,
        head_sha,
        start_sha,
    }))
}

/// Fetch and flatten discussions for the CLI overlay (live from GitLab).
pub async fn list_discussions(pool: &DbPool, mr_id: i64) -> Result<Vec<Thread>, AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    let discussions = client.list_discussions(project_id, iid).await?;
    Ok(discussions
        .into_iter()
        .map(|d| {
            let first_pos = d.notes.iter().find_map(|n| n.position.clone());
            let resolvable = d.notes.iter().any(|n| n.resolvable);
            let resolved = d.notes.iter().any(|n| n.resolved.unwrap_or(false));
            Thread {
                id: d.id,
                resolvable,
                resolved,
                file_path: first_pos
                    .as_ref()
                    .and_then(|p| p.new_path.clone().or_else(|| p.old_path.clone())),
                old_line: first_pos.as_ref().and_then(|p| p.old_line),
                new_line: first_pos.as_ref().and_then(|p| p.new_line),
                notes: d
                    .notes
                    .into_iter()
                    .map(|n| ThreadNote {
                        author: n.author.username,
                        body: n.body,
                        system: n.system,
                    })
                    .collect(),
            }
        })
        .collect())
}

/// Post a general (MR-level) comment.
pub async fn post_general_comment(pool: &DbPool, mr_id: i64, body: &str) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.add_comment(project_id, iid, body).await?;
    Ok(())
}

/// Post an inline comment at a position. `old_line`/`new_line` follow the GitLab
/// convention: added lines set only `new_line`, deleted only `old_line`, context
/// both.
pub async fn post_inline_comment(
    pool: &DbPool,
    mr_id: i64,
    body: &str,
    file_path: &str,
    old_line: Option<i64>,
    new_line: Option<i64>,
    refs: &DiffRefs,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .add_inline_comment(
            project_id,
            iid,
            body,
            file_path,
            old_line,
            new_line,
            &refs.base_sha,
            &refs.head_sha,
            &refs.start_sha,
            None,
        )
        .await?;
    Ok(())
}

/// Reply to an existing discussion thread.
pub async fn reply(
    pool: &DbPool,
    mr_id: i64,
    discussion_id: &str,
    body: &str,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .reply_to_discussion(project_id, iid, discussion_id, body)
        .await?;
    Ok(())
}

/// Resolve or unresolve a discussion thread.
pub async fn resolve(
    pool: &DbPool,
    mr_id: i64,
    discussion_id: &str,
    resolved: bool,
) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client
        .resolve_discussion(project_id, iid, discussion_id, resolved)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offsets_single_line_anchor_at_end() {
        // selection 13..=15, anchor 15 -> 2 above, 0 below (desktop default).
        assert_eq!(suggestion_offsets(13, 15, 15), (2, 0));
    }

    #[test]
    fn offsets_anchor_at_start() {
        assert_eq!(suggestion_offsets(13, 15, 13), (0, 2));
    }

    #[test]
    fn offsets_single_line() {
        assert_eq!(suggestion_offsets(20, 20, 20), (0, 0));
    }

    #[test]
    fn block_wraps_replacement() {
        assert_eq!(
            build_suggestion_block("const x = 2;", 0, 0),
            "```suggestion:-0+0\nconst x = 2;\n```\n"
        );
    }

    #[test]
    fn block_multiline_with_offsets() {
        let b = build_suggestion_block("a\nb", 0, 1);
        assert_eq!(b, "```suggestion:-0+1\na\nb\n```\n");
    }

    #[test]
    fn resolve_context_new_side() {
        // context line 2 on the new side maps to old line 2.
        let diff = "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
        assert_eq!(resolve_context_lines(diff, 1, false), Some((1, 1)));
    }

    #[test]
    fn resolve_context_returns_none_for_changed_line() {
        let diff = "@@ -1,2 +1,2 @@\n-old\n+new\n";
        assert_eq!(resolve_context_lines(diff, 1, false), None);
    }

    const RANGE_DIFF: &str = "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -10,4 +10,5 @@ fn\n a\n-b\n+B\n+B2\n c\n d\n\\ No newline at end of file\n";

    #[test]
    fn position_of_added_line_keeps_old_counter() {
        // Like GitLab's parser: "+B2" sits at old 12 (where "c" is), new 12.
        let p = diff_line_position(RANGE_DIFF, 12, false).unwrap();
        assert_eq!((p.kind, p.old_pos, p.new_pos), (DiffLineKind::Added, 12, 12));
    }

    #[test]
    fn position_of_removed_and_context_lines() {
        let removed = diff_line_position(RANGE_DIFF, 11, true).unwrap();
        assert_eq!((removed.kind, removed.old_pos, removed.new_pos), (DiffLineKind::Removed, 11, 11));
        let context = diff_line_position(RANGE_DIFF, 14, false).unwrap();
        assert_eq!((context.kind, context.old_pos, context.new_pos), (DiffLineKind::Context, 13, 14));
        assert_eq!(diff_line_position(RANGE_DIFF, 15, false), None);
    }

    #[test]
    fn line_code_is_sha1_of_path() {
        // Known vector: sha1("abc").
        assert_eq!(line_code("abc", 0, 1), "a9993e364706816aba3e25717850c26c9cd0d89d_0_1");
    }

    #[test]
    fn line_range_from_removed_to_context() {
        let r = build_line_range(RANGE_DIFF, "f.ts", (11, true), (13, false)).unwrap();
        assert_eq!(r["start"]["type"], "old");
        assert_eq!(r["start"]["old_line"], 11);
        assert!(r["start"].get("new_line").is_none());
        assert!(r["start"]["line_code"].as_str().unwrap().ends_with("_11_11"));
        assert!(r["end"].get("type").is_none());
        assert_eq!((r["end"]["old_line"].clone(), r["end"]["new_line"].clone()), (12.into(), 13.into()));
    }

    #[test]
    fn line_range_none_for_single_line_or_outside_diff() {
        assert_eq!(build_line_range(RANGE_DIFF, "f.ts", (11, false), (11, false)), None);
        assert_eq!(build_line_range(RANGE_DIFF, "f.ts", (2, false), (11, false)), None);
    }

    #[tokio::test]
    async fn diff_refs_none_when_absent() {
        use crate::db;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        assert!(diff_refs_from_cache(&pool, 1).await.unwrap().is_none());
    }
}
