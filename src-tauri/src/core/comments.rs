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
}
