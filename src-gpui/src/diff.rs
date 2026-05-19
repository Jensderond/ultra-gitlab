//! Minimal unified-diff parser for the GPUI frontend.
//!
//! Splits a unified diff into hunks of typed lines so the renderer can
//! show two line-number gutters (old / new) plus a tinted background for
//! added and removed lines — the same shape Zed uses for its inline
//! diff view in `crates/editor/src/git/`. We can't reuse
//! `ultra_gitlab_lib::commands::mr::parse_unified_diff_public` because
//! the `commands` module is gated behind the `tauri-app` feature.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Add,
    Remove,
    Context,
}

#[derive(Debug, Clone)]
pub struct DiffLine {
    pub kind: LineKind,
    pub content: String,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct DiffHunk {
    pub header: String,
    /// Old-side starting line. Currently only read by tests; kept on the
    /// struct so callers can jump to a hunk by line number later.
    #[allow(dead_code)]
    pub old_start: i64,
    #[allow(dead_code)]
    pub new_start: i64,
    pub lines: Vec<DiffLine>,
}

pub fn parse_unified(diff: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut current: Option<DiffHunk> = None;
    let mut old_ln = 0i64;
    let mut new_ln = 0i64;

    for line in diff.lines() {
        if line.starts_with("@@") {
            if let Some(h) = current.take() {
                hunks.push(h);
            }
            if let Some((os, _oc, ns, _nc)) = parse_hunk_header(line) {
                old_ln = os;
                new_ln = ns;
                current = Some(DiffHunk {
                    header: line.to_string(),
                    old_start: os,
                    new_start: ns,
                    lines: Vec::new(),
                });
            }
            continue;
        }

        let Some(hunk) = current.as_mut() else {
            continue;
        };

        if let Some(rest) = line.strip_prefix('+') {
            let ln = new_ln;
            new_ln += 1;
            hunk.lines.push(DiffLine {
                kind: LineKind::Add,
                content: rest.to_string(),
                old_line: None,
                new_line: Some(ln),
            });
        } else if let Some(rest) = line.strip_prefix('-') {
            let ln = old_ln;
            old_ln += 1;
            hunk.lines.push(DiffLine {
                kind: LineKind::Remove,
                content: rest.to_string(),
                old_line: Some(ln),
                new_line: None,
            });
        } else if let Some(rest) = line.strip_prefix(' ') {
            let o = old_ln;
            let n = new_ln;
            old_ln += 1;
            new_ln += 1;
            hunk.lines.push(DiffLine {
                kind: LineKind::Context,
                content: rest.to_string(),
                old_line: Some(o),
                new_line: Some(n),
            });
        }
        // `\ No newline at end of file` and any other unprefixed metadata
        // lines are dropped — they don't affect line numbering.
    }

    if let Some(h) = current.take() {
        hunks.push(h);
    }

    hunks
}

fn parse_hunk_header(line: &str) -> Option<(i64, i64, i64, i64)> {
    // @@ -old_start,old_count +new_start,new_count @@ optional-context
    let content = line.trim_start_matches("@@");
    let close_at = content.find("@@")?;
    let head = content[..close_at].trim();
    let parts: Vec<&str> = head.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let (os, oc) = parse_range(parts[0].trim_start_matches('-'))?;
    let (ns, nc) = parse_range(parts[1].trim_start_matches('+'))?;
    Some((os, oc, ns, nc))
}

fn parse_range(s: &str) -> Option<(i64, i64)> {
    if let Some((start, count)) = s.split_once(',') {
        Some((start.parse().ok()?, count.parse().ok()?))
    } else {
        Some((s.parse().ok()?, 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_diff() {
        let input = "@@ -1,3 +1,4 @@\n one\n-two\n+two-prime\n+extra\n three\n";
        let hunks = parse_unified(input);
        assert_eq!(hunks.len(), 1);
        let h = &hunks[0];
        assert_eq!(h.old_start, 1);
        assert_eq!(h.new_start, 1);
        assert_eq!(h.lines.len(), 5);
        assert_eq!(h.lines[0].kind, LineKind::Context);
        assert_eq!(h.lines[0].old_line, Some(1));
        assert_eq!(h.lines[0].new_line, Some(1));
        assert_eq!(h.lines[1].kind, LineKind::Remove);
        assert_eq!(h.lines[1].old_line, Some(2));
        assert_eq!(h.lines[1].new_line, None);
        assert_eq!(h.lines[2].kind, LineKind::Add);
        assert_eq!(h.lines[2].new_line, Some(2));
        assert_eq!(h.lines[3].kind, LineKind::Add);
        assert_eq!(h.lines[3].new_line, Some(3));
        assert_eq!(h.lines[4].kind, LineKind::Context);
        assert_eq!(h.lines[4].old_line, Some(3));
        assert_eq!(h.lines[4].new_line, Some(4));
    }

    #[test]
    fn parses_range_without_count() {
        assert_eq!(parse_range("10"), Some((10, 1)));
        assert_eq!(parse_range("10,5"), Some((10, 5)));
    }

    #[test]
    fn parses_multiple_hunks() {
        let input = "@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,1 +10,1 @@\n-c\n+d\n";
        let hunks = parse_unified(input);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[1].old_start, 10);
    }
}
