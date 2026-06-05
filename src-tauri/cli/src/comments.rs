//! CLI comment orchestration: what to compose, and posting the result.

use crate::app::App;
use crate::event::AppEvent;
use crate::ui::diff::{RowKind, RowMeta};
use ultra_gitlab_lib::core::comments;

/// A compose request raised by a keypress, performed by the run loop (which owns
/// the terminal) after the key handler returns.
#[derive(Debug, Clone)]
pub enum PendingCompose {
    General { mr_id: i64 },
    Inline {
        mr_id: i64,
        file_path: String,
        old_line: Option<i64>,
        new_line: Option<i64>,
        refs: comments::DiffRefs,
    },
    Reply { mr_id: i64, discussion_id: String },
    Suggestion {
        mr_id: i64,
        file_path: String,
        original: String,
        above: i64,
        below: i64,
        anchor_old: Option<i64>,
        anchor_new: Option<i64>,
        refs: comments::DiffRefs,
    },
}

/// Seed text + temp-file extension + comment-stripping flag for a compose.
pub fn seed_for(p: &PendingCompose, iid: i64) -> (String, &'static str, bool) {
    match p {
        PendingCompose::General { .. } => {
            (format!("# General comment on MR !{iid}\n# Lines starting with # are ignored.\n\n"), "md", true)
        }
        PendingCompose::Inline { file_path, new_line, old_line, .. } => {
            let line = new_line.or(*old_line).unwrap_or(0);
            (format!("# Inline comment on {file_path}:{line}\n# Lines starting with # are ignored.\n\n"), "md", true)
        }
        PendingCompose::Reply { .. } => {
            ("# Reply\n# Lines starting with # are ignored.\n\n".to_string(), "md", true)
        }
        PendingCompose::Suggestion { original, file_path, .. } => {
            let ext = file_path.rsplit('.').next().unwrap_or("txt").to_string();
            // ext must be 'static for the return type; fall back to a small set.
            let ext: &'static str = match ext.as_str() {
                "rs" => "rs", "ts" => "ts", "tsx" => "tsx", "js" => "js", "jsx" => "jsx",
                "py" => "py", "go" => "go", "json" => "json", "css" => "css", "html" => "html",
                "md" => "md", "toml" => "toml", "yaml" | "yml" => "yaml",
                _ => "txt",
            };
            (original.clone(), ext, false)
        }
    }
}

/// Spawn the background task that posts a composed comment body.
pub fn post(app: &App, p: PendingCompose, body: String) {
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let result = run_post(&pool, p, body).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::CommentPosted(result));
    });
}

/// Derive the inline-comment position from a selected diff row. Suggestions and
/// comments attach to a single anchor row (the range's last row). Added/context
/// rows use `new_line`; deletion rows use `old_line`. Returns `None` for a
/// non-selectable row.
pub fn position_for(row: &RowMeta) -> Option<(Option<i64>, Option<i64>)> {
    match row.kind {
        RowKind::Add => Some((None, row.new_line)),
        RowKind::Context => Some((row.old_line, row.new_line)),
        RowKind::Remove => Some((row.old_line, None)),
        _ => None,
    }
}

/// New-side line span for a suggestion; anchor is the line GitLab attaches to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SuggestionSeed {
    pub start_line: i64,
    pub end_line: i64,
    pub anchor_line: i64,
}

/// Extract the new-side source lines covered by the cursor/range, plus the
/// suggestion anchor's new line number. Returns `None` if the selection has no
/// new-side line (pure deletions — GitLab suggestions replace new-file content).
///
/// `rows` is the diff's row metadata; `lo`/`hi` are inclusive row indices.
pub fn suggestion_seed(rows: &[RowMeta], lo: usize, hi: usize) -> Option<SuggestionSeed> {
    let mut new_lines: Vec<i64> = Vec::new();
    for row in &rows[lo..=hi.min(rows.len().saturating_sub(1))] {
        if matches!(row.kind, RowKind::Add | RowKind::Context) {
            if let Some(n) = row.new_line {
                new_lines.push(n);
            }
        }
    }
    let start = *new_lines.first()?;
    let end = *new_lines.last()?;
    Some(SuggestionSeed { start_line: start, end_line: end, anchor_line: end })
}

async fn run_post(
    pool: &ultra_gitlab_lib::db::pool::DbPool,
    p: PendingCompose,
    body: String,
) -> Result<i64, ultra_gitlab_lib::error::AppError> {
    match p {
        PendingCompose::General { mr_id } => {
            comments::post_general_comment(pool, mr_id, &body).await?;
            Ok(mr_id)
        }
        PendingCompose::Inline { mr_id, file_path, old_line, new_line, refs } => {
            comments::post_inline_comment(pool, mr_id, &body, &file_path, old_line, new_line, &refs).await?;
            Ok(mr_id)
        }
        PendingCompose::Reply { mr_id, discussion_id } => {
            comments::reply(pool, mr_id, &discussion_id, &body).await?;
            Ok(mr_id)
        }
        PendingCompose::Suggestion { .. } => {
            // Suggestions are turned into an Inline post by the preview overlay;
            // they never reach run_post directly.
            unreachable!("PendingCompose::Suggestion is posted via the preview overlay")
        }
    }
}

/// Concatenate the new-side content of rows `lo..=hi` from the file's unified
/// diff (added + context lines), for seeding the editor and the preview.
pub fn selection_text(rows: &[RowMeta], diff_content: &str, lo: usize, hi: usize) -> String {
    use ultra_gitlab_lib::commands::mr::parse_unified_diff_public;
    // Flatten the diff into the same row order the renderer used: hunk header,
    // body lines, trailing blank — so row indices line up with `rows`.
    let hunks = parse_unified_diff_public(diff_content);
    let mut flat: Vec<Option<String>> = Vec::new();
    for h in &hunks {
        flat.push(None); // hunk header row
        for dl in &h.lines {
            let is_new_side = dl.line_type == "add" || dl.line_type != "remove";
            flat.push(if is_new_side { Some(dl.content.clone()) } else { None });
        }
        flat.push(None); // trailing blank row
    }
    let hi = hi.min(flat.len().saturating_sub(1));
    let mut out: Vec<String> = Vec::new();
    for (i, cell) in flat.iter().enumerate() {
        if i >= lo && i <= hi {
            if let Some(text) = cell {
                // Only include rows that are selectable code lines.
                if rows.get(i).map(|r| r.selectable()).unwrap_or(false) {
                    out.push(text.clone());
                }
            }
        }
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::position_for;
    use crate::ui::diff::{RowKind, RowMeta};

    #[test]
    fn added_line_uses_new_only() {
        let r = RowMeta { kind: RowKind::Add, old_line: None, new_line: Some(5) };
        assert_eq!(position_for(&r), Some((None, Some(5))));
    }

    #[test]
    fn deleted_line_uses_old_only() {
        let r = RowMeta { kind: RowKind::Remove, old_line: Some(7), new_line: None };
        assert_eq!(position_for(&r), Some((Some(7), None)));
    }

    #[test]
    fn context_line_uses_both() {
        let r = RowMeta { kind: RowKind::Context, old_line: Some(3), new_line: Some(4) };
        assert_eq!(position_for(&r), Some((Some(3), Some(4))));
    }
}

#[cfg(test)]
mod suggestion_tests {
    use super::suggestion_seed;
    use crate::ui::diff::{RowKind, RowMeta};

    fn add(n: i64) -> RowMeta { RowMeta { kind: RowKind::Add, old_line: None, new_line: Some(n) } }
    fn del() -> RowMeta { RowMeta { kind: RowKind::Remove, old_line: Some(9), new_line: None } }

    #[test]
    fn spans_new_lines_anchor_at_end() {
        let rows = vec![add(13), add(14), add(15)];
        let s = super::suggestion_seed(&rows, 0, 2).unwrap();
        assert_eq!((s.start_line, s.end_line, s.anchor_line), (13, 15, 15));
    }

    #[test]
    fn pure_deletion_has_no_seed() {
        let rows = vec![del(), del()];
        assert!(suggestion_seed(&rows, 0, 1).is_none());
    }
}
