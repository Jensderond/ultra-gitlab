/// Parses `.gitattributes` file content and extracts glob patterns
/// marked with `linguist-generated` (or `linguist-generated=true`).
///
/// Lines with `linguist-generated=false` are ignored (explicit opt-out).
/// Comment lines (starting with `#`) and blank lines are also ignored.
pub fn parse_gitattributes(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|line| {
            let line = line.trim();

            // Skip blank lines and comments
            if line.is_empty() || line.starts_with('#') {
                return None;
            }

            // Split into pattern and attributes
            let mut parts = line.split_whitespace();
            let pattern = parts.next()?;

            // Check if any attribute is linguist-generated (not =false)
            let has_generated = parts.any(|attr| {
                attr == "linguist-generated"
                    || attr == "linguist-generated=true"
                    || attr == "-linguist-generated=false"
            });

            // Explicitly check for opt-out
            let has_opt_out = line
                .split_whitespace()
                .skip(1)
                .any(|attr| attr == "linguist-generated=false");

            if has_generated && !has_opt_out {
                Some(pattern.to_string())
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_typical_lock_pattern() {
        let content = "*.lock linguist-generated";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.lock"]);
    }

    #[test]
    fn test_linguist_generated_equals_true() {
        let content = "*.min.js linguist-generated=true";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.min.js"]);
    }

    #[test]
    fn test_linguist_generated_false_ignored() {
        let content = "src/important.js linguist-generated=false";
        let result = parse_gitattributes(content);
        assert!(result.is_empty());
    }

    #[test]
    fn test_comment_lines_ignored() {
        let content = "# This is a comment\n*.lock linguist-generated";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.lock"]);
    }

    #[test]
    fn test_blank_lines_ignored() {
        let content = "\n\n*.lock linguist-generated\n\n*.min.js linguist-generated\n";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.lock", "*.min.js"]);
    }

    #[test]
    fn test_empty_input() {
        let result = parse_gitattributes("");
        assert!(result.is_empty());
    }

    #[test]
    fn test_no_matching_attributes() {
        let content = "*.rb text\n*.jpg binary";
        let result = parse_gitattributes(content);
        assert!(result.is_empty());
    }

    #[test]
    fn test_multiple_attributes_on_one_line() {
        let content = "package-lock.json text linguist-generated";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["package-lock.json"]);
    }

    #[test]
    fn test_multiple_patterns() {
        let content = "\
# Generated files
*.lock linguist-generated
*.min.js linguist-generated=true
*.min.css linguist-generated
*.map linguist-generated

# Source files (not generated)
*.rs text
*.ts text
src/important.js linguist-generated=false
";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.lock", "*.min.js", "*.min.css", "*.map"]);
    }

    #[test]
    fn test_glob_patterns_preserved() {
        let content = "\
**/*.generated.* linguist-generated
vendor/**/* linguist-generated
dist/[a-z]*.js linguist-generated
";
        let result = parse_gitattributes(content);
        assert_eq!(
            result,
            vec!["**/*.generated.*", "vendor/**/*", "dist/[a-z]*.js"]
        );
    }

    #[test]
    fn test_whitespace_only_lines() {
        let content = "   \n  \t  \n*.lock linguist-generated";
        let result = parse_gitattributes(content);
        assert_eq!(result, vec!["*.lock"]);
    }

    #[test]
    fn test_pattern_with_only_pattern_no_attribute() {
        let content = "*.lock";
        let result = parse_gitattributes(content);
        assert!(result.is_empty());
    }
}
