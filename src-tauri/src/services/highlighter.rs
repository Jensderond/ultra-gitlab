//! Syntax highlighting service using tree-sitter.
//!
//! This service provides syntax highlighting for diff content using tree-sitter
//! language grammars. Supports JavaScript, TypeScript, Python, Rust, Go, Java,
//! C, C++, Ruby, PHP, Swift, and Kotlin.

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
    java: Option<HighlightConfiguration>,
    c: Option<HighlightConfiguration>,
    cpp: Option<HighlightConfiguration>,
    ruby: Option<HighlightConfiguration>,
    php: Option<HighlightConfiguration>,
    swift: Option<HighlightConfiguration>,
    kotlin: Option<HighlightConfiguration>,
}

/// Cached highlight configurations for each language.
static CONFIGS: LazyLock<LanguageConfigs> = LazyLock::new(|| LanguageConfigs {
    javascript: create_js_config(),
    typescript: create_ts_config(),
    tsx: create_tsx_config(),
    python: create_python_config(),
    rust: create_rust_config(),
    go: create_go_config(),
    java: create_java_config(),
    c: create_c_config(),
    cpp: create_cpp_config(),
    ruby: create_ruby_config(),
    php: create_php_config(),
    swift: create_swift_config(),
    kotlin: create_kotlin_config(),
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
            "java" => CONFIGS.java.as_ref(),
            "c" | "h" => CONFIGS.c.as_ref(),
            "cpp" | "cc" | "cxx" | "c++" | "hpp" | "hxx" | "h++" => CONFIGS.cpp.as_ref(),
            "rb" | "ruby" => CONFIGS.ruby.as_ref(),
            "php" | "php3" | "php4" | "php5" | "php7" | "php8" | "phtml" => CONFIGS.php.as_ref(),
            "swift" => CONFIGS.swift.as_ref(),
            "kt" | "kts" | "kotlin" => CONFIGS.kotlin.as_ref(),
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

/// Create Java highlight configuration.
fn create_java_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_java::LANGUAGE.into(),
        "java",
        tree_sitter_java::HIGHLIGHTS_QUERY,
        "",
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create C highlight configuration.
fn create_c_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_c::LANGUAGE.into(),
        "c",
        tree_sitter_c::HIGHLIGHT_QUERY,
        "",
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create C++ highlight configuration.
fn create_cpp_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_cpp::LANGUAGE.into(),
        "cpp",
        tree_sitter_cpp::HIGHLIGHT_QUERY,
        "",
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Ruby highlight configuration.
fn create_ruby_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_ruby::LANGUAGE.into(),
        "ruby",
        tree_sitter_ruby::HIGHLIGHTS_QUERY,
        "",
        tree_sitter_ruby::LOCALS_QUERY,
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create PHP highlight configuration.
fn create_php_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_php::LANGUAGE_PHP.into(),
        "php",
        tree_sitter_php::HIGHLIGHTS_QUERY,
        tree_sitter_php::INJECTIONS_QUERY,
        "",
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Swift highlight configuration.
fn create_swift_config() -> Option<HighlightConfiguration> {
    let mut config = HighlightConfiguration::new(
        tree_sitter_swift::LANGUAGE.into(),
        "swift",
        tree_sitter_swift::HIGHLIGHTS_QUERY,
        "",
        tree_sitter_swift::LOCALS_QUERY,
    )
    .ok()?;

    config.configure(HIGHLIGHT_NAMES);
    Some(config)
}

/// Create Kotlin highlight configuration.
///
/// Note: tree-sitter-kotlin uses an older tree-sitter API that's incompatible
/// with the version we use. Returning None until the crate is updated.
fn create_kotlin_config() -> Option<HighlightConfiguration> {
    // tree-sitter-kotlin 0.3.x uses tree-sitter 0.20, incompatible with 0.26
    // TODO: Enable when tree-sitter-kotlin updates to compatible API
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supports_language() {
        // Original languages
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

        // Additional languages (T127)
        assert!(SyntaxHighlighter::supports_language("java"));
        assert!(SyntaxHighlighter::supports_language("c"));
        assert!(SyntaxHighlighter::supports_language("h"));
        assert!(SyntaxHighlighter::supports_language("cpp"));
        assert!(SyntaxHighlighter::supports_language("cc"));
        assert!(SyntaxHighlighter::supports_language("hpp"));
        assert!(SyntaxHighlighter::supports_language("rb"));
        assert!(SyntaxHighlighter::supports_language("ruby"));
        assert!(SyntaxHighlighter::supports_language("php"));
        assert!(SyntaxHighlighter::supports_language("swift"));
        // Kotlin disabled until tree-sitter-kotlin updates to compatible API
        // assert!(SyntaxHighlighter::supports_language("kt"));
        // assert!(SyntaxHighlighter::supports_language("kotlin"));

        // Extensions with dots
        assert!(SyntaxHighlighter::supports_language(".rs"));
        assert!(SyntaxHighlighter::supports_language(".js"));
        assert!(SyntaxHighlighter::supports_language(".java"));

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

    #[test]
    fn test_tokenize_java() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "public class Main { public static void main(String[] args) {} }";
        let tokens = highlighter.tokenize(source, "java").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_c() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "int main() { return 0; }";
        let tokens = highlighter.tokenize(source, "c").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_cpp() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "class Foo { public: void bar(); };";
        let tokens = highlighter.tokenize(source, "cpp").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_ruby() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "def hello; puts 'world'; end";
        let tokens = highlighter.tokenize(source, "rb").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_php() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "<?php echo 'Hello, World!'; ?>";
        let tokens = highlighter.tokenize(source, "php").unwrap();

        assert!(!tokens.is_empty());
    }

    #[test]
    fn test_tokenize_swift() {
        let mut highlighter = SyntaxHighlighter::new();
        let source = "func greet() -> String { return \"Hello\" }";
        let tokens = highlighter.tokenize(source, "swift").unwrap();

        assert!(!tokens.is_empty());
    }

    // Kotlin disabled until tree-sitter-kotlin updates to compatible API
    // #[test]
    // fn test_tokenize_kotlin() {
    //     let mut highlighter = SyntaxHighlighter::new();
    //     let source = "fun main() { println(\"Hello\") }";
    //     let tokens = highlighter.tokenize(source, "kt").unwrap();
    //     assert!(!tokens.is_empty());
    // }
}
