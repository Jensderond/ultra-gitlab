//! Classify changed files as "ignored" (generated/lock/etc.) by matching their
//! paths against glob patterns — the same check the desktop applies to collapse
//! generated files out of the review.
//!
//! The desktop matches with picomatch (`{ dot: true }`); we mirror that with
//! `globset` configured so `*`/`?` stop at `/`, `**` crosses directories, and
//! `{a,b}` / `[a-z]` work — and dotfiles match like any other path. Patterns
//! come from two sources, combined exactly as the desktop combines them: the
//! project's `.gitattributes` `linguist-generated` entries plus the user's
//! configured collapse patterns.

use globset::{GlobBuilder, GlobSet, GlobSetBuilder};
use std::collections::HashSet;

/// Build a matcher from glob patterns. Patterns that fail to compile are
/// skipped individually (picomatch is lenient; one bad pattern shouldn't sink
/// the rest). Returns `None` when no usable pattern remains, letting callers
/// short-circuit to "nothing ignored".
fn build_matcher(patterns: &[String]) -> Option<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    let mut any = false;
    for pat in patterns {
        // literal_separator: `*` and `?` do not match `/`; `**` is required to
        // cross directories — matching picomatch's default path semantics.
        if let Ok(glob) = GlobBuilder::new(pat).literal_separator(true).build() {
            builder.add(glob);
            any = true;
        }
    }
    if !any {
        return None;
    }
    builder.build().ok()
}

/// Return the set of paths (from `paths`) that match any of `patterns`.
pub fn ignored_paths(paths: &[String], patterns: &[String]) -> HashSet<String> {
    let Some(set) = build_matcher(patterns) else {
        return HashSet::new();
    };
    paths
        .iter()
        .filter(|p| set.is_match(p.as_str()))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ignored(paths: &[&str], patterns: &[&str]) -> Vec<String> {
        let paths: Vec<String> = paths.iter().map(|s| s.to_string()).collect();
        let patterns: Vec<String> = patterns.iter().map(|s| s.to_string()).collect();
        let mut out: Vec<String> = ignored_paths(&paths, &patterns).into_iter().collect();
        out.sort();
        out
    }

    #[test]
    fn double_star_crosses_directories() {
        // The user's headline example: project/**/*.yaml
        assert_eq!(
            ignored(
                &[
                    "project/config/app.yaml",
                    "project/a/b/c/deep.yaml",
                    "project/app.yaml",
                    "other/app.yaml",
                    "project/app.json",
                ],
                &["project/**/*.yaml"],
            ),
            vec![
                "project/a/b/c/deep.yaml".to_string(),
                "project/app.yaml".to_string(),
                "project/config/app.yaml".to_string(),
            ]
        );
    }

    #[test]
    fn single_star_does_not_cross_slash() {
        // `*.lock` only matches at the root; nested needs `**/`.
        assert_eq!(
            ignored(&["Cargo.lock", "src/sub.lock"], &["*.lock"]),
            vec!["Cargo.lock".to_string()]
        );
        assert_eq!(
            ignored(&["Cargo.lock", "src/sub.lock"], &["**/*.lock"]),
            vec!["Cargo.lock".to_string(), "src/sub.lock".to_string()]
        );
    }

    #[test]
    fn brace_alternation_matches_extensions() {
        assert_eq!(
            ignored(
                &[
                    "ui/fonts/Inter.woff2",
                    "ui/fonts/Inter.ttf",
                    "ui/fonts/Inter.css",
                ],
                &["**/fonts/*.{woff2,woff,ttf,svg}"],
            ),
            vec![
                "ui/fonts/Inter.ttf".to_string(),
                "ui/fonts/Inter.woff2".to_string(),
            ]
        );
    }

    #[test]
    fn middle_segment_glob() {
        // `*/public/**/*.svg`: exactly one leading segment, then public/**.
        assert_eq!(
            ignored(
                &[
                    "app/public/icons/x.svg",
                    "app/public/x.svg",
                    "app/private/x.svg",
                ],
                &["*/public/**/*.svg"],
            ),
            vec![
                "app/public/icons/x.svg".to_string(),
                "app/public/x.svg".to_string(),
            ]
        );
    }

    #[test]
    fn combines_multiple_patterns() {
        assert_eq!(
            ignored(
                &["Cargo.lock", "src/main.rs", "dist/bundle.min.js"],
                &["Cargo.lock", "**/*.min.js"],
            ),
            vec!["Cargo.lock".to_string(), "dist/bundle.min.js".to_string()]
        );
    }

    #[test]
    fn dotfiles_match_like_any_path() {
        // picomatch is used with { dot: true }; globset matches dotfiles too.
        assert_eq!(
            ignored(&[".eslintrc.generated.json"], &["*.generated.*"]),
            vec![".eslintrc.generated.json".to_string()]
        );
    }

    #[test]
    fn empty_patterns_ignore_nothing() {
        assert!(ignored(&["Cargo.lock", "a/b.yaml"], &[]).is_empty());
    }

    #[test]
    fn invalid_pattern_is_skipped_not_fatal() {
        // An unclosed char class is invalid; the valid pattern still applies.
        assert_eq!(
            ignored(&["Cargo.lock", "a.txt"], &["[unclosed", "*.lock"]),
            vec!["Cargo.lock".to_string()]
        );
    }
}
