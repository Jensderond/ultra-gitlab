//! Syntax highlighting service using tree-sitter.
//!
//! This service provides syntax highlighting for diff content using tree-sitter
//! language grammars. It supports JavaScript, TypeScript, Python, Rust, and Go.

use std::sync::LazyLock;
use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

use crate::error::AppError;

/// Recognized highlight names mapped to CSS class names.
/// These match common syntax highlighting themes.
static HIGHLIGHT_NAMES: &[&str] = &[
    "attribute",
    "comment",
    "constant",
    "constant.builtin",
    "constructor",
    "embedded",
    "escape",
    "function",
    "function.builtin",
    "function.macro",
    "keyword",
    "label",
    "number",
    "operator",
    "property",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "string",
    "string.special",
    "tag",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.parameter",
];

/// Language configuration container.
struct LanguageConfigs {
    javascript: Option<HighlightConfiguration>,
    typescript: Option<HighlightConfiguration>,
    tsx: Option<HighlightConfiguration>,
    python: Option<HighlightConfiguration>,
    rust: Option<HighlightConfiguration>,
    go: Option<HighlightConfiguration>,
}

/// Cached highlight configurations for each language.
static CONFIGS: LazyLock<LanguageConfigs> = LazyLock::new(|| LanguageConfigs {
    javascript: create_js_config(),
    typescript: create_ts_config(),
    tsx: create_tsx_config(),
    python: create_python_config(),
    rust: create_rust_config(),
    go: create_go_config(),
});

/// A syntax highlight token with position and CSS class.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightToken {
    /// Start byte position in the source.
    pub start: usize,
    /// End byte position in the source.
    pub end: usize,
    /// CSS class name for styling.
    pub class: String,
}

/// Syntax highlighter service.
pub struct SyntaxHighlighter {
    highlighter: Highlighter,
}

impl Default for SyntaxHighlighter {
    fn default() -> Self {
        Self::new()
    }
}

impl SyntaxHighlighter {
    /// Create a new syntax highlighter instance.
    pub fn new() -> Self {
        Self {
            highlighter: Highlighter::new(),
        }
    }

    /// Get the highlight configuration for a language by extension or name.
    pub fn get_config(language: &str) -> Option<&'static HighlightConfiguration> {
        let lang = language.to_lowercase();
        let key = lang.trim_start_matches('.');

        match key {
            "js" | "javascript" | "jsx" | "mjs" | "cjs" => CONFIGS.javascript.as_ref(),
            "ts" | "typescript" => CONFIGS.typescript.as_ref(),
            "tsx" => CONFIGS.tsx.as_ref(),
            "py" | "python" => CONFIGS.python.as_ref(),
            "rs" | "rust" => CONFIGS.rust.as_ref(),
            "go" | "golang" => CONFIGS.go.as_ref(),
            _ => None,
        }
    }

    /// Check if a language is supported.
    pub fn supports_language(language: &str) -> bool {
        Self::get_config(language).is_some()
    }

    /// Tokenize source code and return syntax highlighting tokens.
    ///
    /// # Arguments
    /// * `source` - The source code to highlight
    /// * `language` - The language extension (e.g., "rs", "py", "js")
    ///
    /// # Returns
    /// A vector of highlight tokens, or an empty vector if the language is not supported.
    pub fn tokenize(&mut self, source: &str, language: &str) -> Result<Vec<HighlightToken>, AppError> {
        let config = match Self::get_config(language) {
            Some(c) => c,
            None => return Ok(Vec::new()), // Unsupported language, return empty tokens
        };

        let source_bytes = source.as_bytes();

        let highlights = self
            .highlighter
            .highlight(config, source_bytes, None, |_| None)
            .map_err(|e| AppError::internal(format!("Highlighting error: {:?}", e)))?;

        let mut tokens = Vec::new();
        let mut highlight_stack: Vec<usize> = Vec::new();

        for event in highlights {
            match event.map_err(|e| AppError::internal(format!("Highlight event error: {:?}", e)))? {
                HighlightEvent::Source { start, end } => {
                    // If we have an active highlight, add a token
                    if let Some(&highlight_idx) = highlight_stack.last() {
                        if let Some(class) = HIGHLIGHT_NAMES.get(highlight_idx) {
                            tokens.push(HighlightToken {
                                start,
                                end,
                                class: class.replace('.', "-"),
                            });
                        }
                    }
                }
                HighlightEvent::HighlightStart(highlight) => {
                    highlight_stack.push(highlight.0);
                }
                HighlightEvent::HighlightEnd => {
                    highlight_stack.pop();
                }
            }
        }

        Ok(tokens)
    }

    /// Tokenize a single line of code.
    ///
    /// This is a convenience method for tokenizing individual diff lines.
    pub fn tokenize_line(&mut self, line: &str, language: &str) -> Result<Vec<HighlightToken>, AppError> {
        self.tokenize(line, language)
    }
}

/// Create JavaScript highlight configuration.
fn create_js_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_javascript::LANGUAGE.into(),
        "javascript",
        tree_sitter_javascript::HIGHLIGHT_QUERY,
        tree_sitter_javascript::INJECTIONS_QUERY,
        tree_sitter_javascript::LOCALS_QUERY,
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create TypeScript highlight configuration.
fn create_ts_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        "typescript",
        tree_sitter_typescript::HIGHLIGHTS_QUERY,
        "",
        tree_sitter_typescript::LOCALS_QUERY,
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create TSX highlight configuration.
fn create_tsx_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_typescript::LANGUAGE_TSX.into(),
        "tsx",
        tree_sitter_typescript::HIGHLIGHTS_QUERY,
        "",
        tree_sitter_typescript::LOCALS_QUERY,
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Python highlight configuration.
fn create_python_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_python::LANGUAGE.into(),
        "python",
        tree_sitter_python::HIGHLIGHTS_QUERY,
        "",
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Rust highlight configuration.
fn create_rust_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_rust::LANGUAGE.into(),
        "rust",
        tree_sitter_rust::HIGHLIGHTS_QUERY,
        tree_sitter_rust::INJECTIONS_QUERY,
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Go highlight configuration.
fn create_go_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_go::LANGUAGE.into(),
        "go",
        tree_sitter_go::HIGHLIGHTS_QUERY,
        "",
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supports_language() {
        assert!(SyntaxHighlighter::supports_language("rs"));
        assert!(SyntaxHighlighter::supports_language("rust"));
        assert!(SyntaxHighlighter::supports_language("js"));
        assert!(SyntaxHighlighter::supports_language("javascript"));
        assert!(SyntaxHighlighter::supports_language("ts"));
        assert!(SyntaxHighlighter::supports_language("typescript"));
        assert!(SyntaxHighlighter::supports_language("tsx"));
        assert!(SyntaxHighlighter::supports_language("py"));
        assert!(SyntaxHighlighter::supports_language("python"));
        assert!(SyntaxHighlighter::supports_language("go"));
        assert!(SyntaxHighlighter::supports_language("golang"));

        // Extensions with dots
        assert!(SyntaxHighlighter::supports_language(".rs"));
        assert!(SyntaxHighlighter::supports_language(".js"));

        // Unsupported
        assert!(!SyntaxHighlighter::supports_language("cobol"));
        assert!(!SyntaxHighlighter::supports_language("unknown"));
    }

    #[test]
    fn test_tokenize_rust() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "fn main() { let x = 42; }";
        let tokens = highlighter.tokenize(source, "rs").unwrap();

        // Should have tokens for fn, main, let, x, 42
        assert!(!tokens.is_empty());

        // Check that we have a keyword token for "fn"
        let fn_tokens: Vec<_> = tokens.iter().filter(|t| t.class == "keyword").collect();
        assert!(!fn_tokens.is_empty());
    }

    #[test]
    fn test_tokenize_javascript() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "const foo = 'bar';";
        let tokens = highlighter.tokenize(source, "js").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_python() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "def hello(): return 'world'";
        let tokens = highlighter.tokenize(source, "py").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_unsupported_returns_empty() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "some random text";
        let tokens = highlighter.tokenize(source, "cobol").unwrap();

        assert!(tokens.is_empty());
    }
}
