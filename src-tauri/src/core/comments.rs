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
}
