//! Tree-sitter syntax highlighting for diff hunks.
//!
//! Zed uses tree-sitter (not LSP) to color code: LSP semantic-tokens
//! round-trip through a process, need a complete on-disk file, and
//! cost hundreds of ms to spin up. Tree-sitter is a pure parser, runs
//! in-process, tolerates broken syntax, and gives us captures in
//! microseconds — perfect for the per-hunk work a diff viewer does.
//!
//! Grammars are linked statically by the `tree-sitter-<lang>` crates,
//! so there is nothing to install at runtime.
//!
//! The flow:
//!   1. `language_from_path` picks a `Language` based on the file
//!      extension / filename.
//!   2. `highlight_hunk` reconstructs the old-side and new-side text
//!      for a hunk (context + removes / context + adds), runs the
//!      highlighter against each side, then folds the byte ranges
//!      back onto individual diff lines.
//!   3. The renderer in `mr_detail` consumes `LineHighlights` and
//!      hands them to `StyledText`.

use std::sync::OnceLock;

use gpui::{rgb, Hsla};
use tree_sitter_highlight::{HighlightConfiguration, Highlighter, HighlightEvent};

use crate::diff::{DiffHunk, DiffLine, LineKind};

/// Capture names we map to colors. Order matters — `configure` builds
/// the index in this order and the highlighter returns `Highlight(idx)`.
/// The list mirrors what Zed's default highlight-themes color, trimmed
/// to the ones our grammars commonly emit. New names can be appended
/// safely; the matching color is looked up by index in `palette()`.
const CAPTURE_NAMES: &[&str] = &[
    "attribute",
    "boolean",
    "comment",
    "constant",
    "constant.builtin",
    "constructor",
    "embedded",
    "escape",
    "function",
    "function.builtin",
    "function.macro",
    "function.method",
    "keyword",
    "label",
    "namespace",
    "number",
    "operator",
    "property",
    "punctuation",
    "punctuation.bracket",
    "punctuation.delimiter",
    "punctuation.special",
    "regex",
    "string",
    "string.special",
    "tag",
    "type",
    "type.builtin",
    "variable",
    "variable.builtin",
    "variable.parameter",
];

/// One-Dark-ish palette. Indices line up 1:1 with `CAPTURE_NAMES`.
/// Captures that don't get a special tint fall back to the default
/// foreground in the renderer.
fn palette() -> [Option<Hsla>; CAPTURE_NAMES.len()] {
    // Color references roughly follow Zed's One Dark.
    let attr = rgb(0xd19a66).into();
    let bool_ = rgb(0xd19a66).into();
    let comment = rgb(0x7c8084).into();
    let constant = rgb(0xd19a66).into();
    let constructor = rgb(0xe5c07b).into();
    let escape = rgb(0x56b6c2).into();
    let func = rgb(0x61afef).into();
    let keyword = rgb(0xc678dd).into();
    let label = rgb(0xe06c75).into();
    let namespace = rgb(0xe5c07b).into();
    let number = rgb(0xd19a66).into();
    let operator = rgb(0xabb2bf).into();
    let property = rgb(0xe06c75).into();
    let punct = rgb(0xabb2bf).into();
    let punct_special = rgb(0x56b6c2).into();
    let regex = rgb(0x98c379).into();
    let string = rgb(0x98c379).into();
    let string_special = rgb(0xe5c07b).into();
    let tag = rgb(0xe06c75).into();
    let typ = rgb(0xe5c07b).into();
    let variable = rgb(0xe06c75).into();
    let var_param = rgb(0xabb2bf).into();

    [
        Some(attr),           // attribute
        Some(bool_),          // boolean
        Some(comment),        // comment
        Some(constant),       // constant
        Some(constant),       // constant.builtin
        Some(constructor),    // constructor
        None,                 // embedded
        Some(escape),         // escape
        Some(func),           // function
        Some(func),           // function.builtin
        Some(func),           // function.macro
        Some(func),           // function.method
        Some(keyword),        // keyword
        Some(label),          // label
        Some(namespace),      // namespace
        Some(number),         // number
        Some(operator),       // operator
        Some(property),       // property
        Some(punct),          // punctuation
        Some(punct),          // punctuation.bracket
        Some(punct),          // punctuation.delimiter
        Some(punct_special),  // punctuation.special
        Some(regex),          // regex
        Some(string),         // string
        Some(string_special), // string.special
        Some(tag),            // tag
        Some(typ),            // type
        Some(typ),            // type.builtin
        Some(variable),       // variable
        Some(variable),       // variable.builtin
        Some(var_param),      // variable.parameter
    ]
}

/// One supported language. Each variant resolves to a single
/// `HighlightConfiguration` built once and cached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    Rust,
    TypeScript,
    Tsx,
    JavaScript,
    Jsx,
    Python,
    Go,
    Ruby,
    Json,
    Bash,
    Html,
    Css,
    Markdown,
    C,
    Cpp,
    Toml,
}

impl Language {
    fn build_config(self) -> Option<HighlightConfiguration> {
        let (lang, name, hi, inj, loc) = match self {
            Language::Rust => (
                tree_sitter_rust::LANGUAGE.into(),
                "rust",
                tree_sitter_rust::HIGHLIGHTS_QUERY,
                tree_sitter_rust::INJECTIONS_QUERY,
                "",
            ),
            Language::TypeScript => (
                tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
                "typescript",
                tree_sitter_typescript::HIGHLIGHTS_QUERY,
                "",
                tree_sitter_typescript::LOCALS_QUERY,
            ),
            Language::Tsx => (
                tree_sitter_typescript::LANGUAGE_TSX.into(),
                "tsx",
                tree_sitter_typescript::HIGHLIGHTS_QUERY,
                "",
                tree_sitter_typescript::LOCALS_QUERY,
            ),
            Language::JavaScript | Language::Jsx => (
                tree_sitter_javascript::LANGUAGE.into(),
                "javascript",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_javascript::INJECTIONS_QUERY,
                tree_sitter_javascript::LOCALS_QUERY,
            ),
            Language::Python => (
                tree_sitter_python::LANGUAGE.into(),
                "python",
                tree_sitter_python::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
            Language::Go => (
                tree_sitter_go::LANGUAGE.into(),
                "go",
                tree_sitter_go::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
            Language::Ruby => (
                tree_sitter_ruby::LANGUAGE.into(),
                "ruby",
                tree_sitter_ruby::HIGHLIGHTS_QUERY,
                "",
                tree_sitter_ruby::LOCALS_QUERY,
            ),
            Language::Json => (
                tree_sitter_json::LANGUAGE.into(),
                "json",
                tree_sitter_json::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
            Language::Bash => (
                tree_sitter_bash::LANGUAGE.into(),
                "bash",
                tree_sitter_bash::HIGHLIGHT_QUERY,
                "",
                "",
            ),
            Language::Html => (
                tree_sitter_html::LANGUAGE.into(),
                "html",
                tree_sitter_html::HIGHLIGHTS_QUERY,
                tree_sitter_html::INJECTIONS_QUERY,
                "",
            ),
            Language::Css => (
                tree_sitter_css::LANGUAGE.into(),
                "css",
                tree_sitter_css::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
            Language::Markdown => (
                tree_sitter_md::LANGUAGE.into(),
                "markdown",
                tree_sitter_md::HIGHLIGHT_QUERY_BLOCK,
                tree_sitter_md::INJECTION_QUERY_BLOCK,
                "",
            ),
            Language::C => (
                tree_sitter_c::LANGUAGE.into(),
                "c",
                tree_sitter_c::HIGHLIGHT_QUERY,
                "",
                "",
            ),
            Language::Cpp => (
                tree_sitter_cpp::LANGUAGE.into(),
                "cpp",
                tree_sitter_cpp::HIGHLIGHT_QUERY,
                "",
                "",
            ),
            Language::Toml => (
                tree_sitter_toml_ng::LANGUAGE.into(),
                "toml",
                tree_sitter_toml_ng::HIGHLIGHTS_QUERY,
                "",
                "",
            ),
        };

        let mut config = HighlightConfiguration::new(lang, name, hi, inj, loc).ok()?;
        config.configure(CAPTURE_NAMES);
        Some(config)
    }
}

/// Lazy per-language config storage. Building a `HighlightConfiguration`
/// parses the highlight query, which is ~milliseconds — fine to do once
/// per language and reuse for every hunk in every diff.
fn config_for(lang: Language) -> Option<&'static HighlightConfiguration> {
    macro_rules! slot {
        ($name:ident) => {{
            static SLOT: OnceLock<Option<HighlightConfiguration>> = OnceLock::new();
            SLOT.get_or_init(|| Language::$name.build_config()).as_ref()
        }};
    }
    match lang {
        Language::Rust => slot!(Rust),
        Language::TypeScript => slot!(TypeScript),
        Language::Tsx => slot!(Tsx),
        Language::JavaScript => slot!(JavaScript),
        Language::Jsx => slot!(Jsx),
        Language::Python => slot!(Python),
        Language::Go => slot!(Go),
        Language::Ruby => slot!(Ruby),
        Language::Json => slot!(Json),
        Language::Bash => slot!(Bash),
        Language::Html => slot!(Html),
        Language::Css => slot!(Css),
        Language::Markdown => slot!(Markdown),
        Language::C => slot!(C),
        Language::Cpp => slot!(Cpp),
        Language::Toml => slot!(Toml),
    }
}

/// Pick a language from a path. Returns `None` for unknown extensions
/// so the renderer can fall back to plain text. Mirrors the same
/// extension list used by the React side's `languageDetection.ts`.
pub fn language_from_path(path: &str) -> Option<Language> {
    let file = path.rsplit('/').next().unwrap_or(path);

    // Filename-only matches (Dockerfile, Makefile, etc).
    match file {
        "Dockerfile" => return Some(Language::Bash),
        "Makefile" | "GNUmakefile" => return Some(Language::Bash),
        "Gemfile" | "Rakefile" | "Vagrantfile" => return Some(Language::Ruby),
        ".bashrc" | ".bash_profile" | ".zshrc" | ".profile" | ".env" => {
            return Some(Language::Bash);
        }
        _ => {}
    }

    let ext = file.rsplit('.').next()?.to_ascii_lowercase();
    let lang = match ext.as_str() {
        "rs" => Language::Rust,
        "ts" | "mts" | "cts" => Language::TypeScript,
        "tsx" => Language::Tsx,
        "js" | "mjs" | "cjs" => Language::JavaScript,
        "jsx" => Language::Jsx,
        "py" | "pyw" | "pyi" => Language::Python,
        "go" => Language::Go,
        "rb" | "gemspec" | "rake" => Language::Ruby,
        "json" | "jsonc" | "json5" => Language::Json,
        "sh" | "bash" | "zsh" | "fish" => Language::Bash,
        "html" | "htm" => Language::Html,
        "css" | "scss" | "sass" | "less" => Language::Css,
        "md" | "markdown" | "mdx" => Language::Markdown,
        "c" | "h" => Language::C,
        "cpp" | "cxx" | "cc" | "hpp" | "hxx" => Language::Cpp,
        "toml" => Language::Toml,
        _ => return None,
    };
    Some(lang)
}

/// Highlight runs for a single visible diff line. Byte offsets are
/// relative to the line's `content` string (which does NOT include
/// the leading `+`/`-`/space — the renderer strips that already).
#[derive(Debug, Default, Clone)]
pub struct LineHighlights {
    pub runs: Vec<(std::ops::Range<usize>, Hsla)>,
}

/// Highlighted hunk: a parallel `Vec<LineHighlights>` matching
/// `hunk.lines`, plus the language used. If `language` is `None` the
/// runs are all empty and the renderer falls back to plain text.
#[derive(Debug, Default, Clone)]
pub struct HighlightedHunk {
    pub per_line: Vec<LineHighlights>,
}

/// Highlight every line in `hunk` using `lang`. Returns a structure
/// with one `LineHighlights` per diff line, indexable by the same idx.
pub fn highlight_hunk(hunk: &DiffHunk, lang: Language) -> HighlightedHunk {
    let Some(config) = config_for(lang) else {
        return HighlightedHunk {
            per_line: vec![LineHighlights::default(); hunk.lines.len()],
        };
    };

    // Reconstruct the two sides. Each diff line in `hunk.lines` already
    // has its leading prefix stripped, so concatenating with `\n`
    // produces what the original file looked like at that hunk on each
    // side.
    let (old_text, old_map) = build_side(&hunk.lines, /* include_kind */ Side::Old);
    let (new_text, new_map) = build_side(&hunk.lines, /* include_kind */ Side::New);

    let mut per_line: Vec<LineHighlights> = vec![LineHighlights::default(); hunk.lines.len()];
    highlight_side(config, &old_text, &old_map, &mut per_line);
    highlight_side(config, &new_text, &new_map, &mut per_line);

    HighlightedHunk { per_line }
}

#[derive(Clone, Copy)]
enum Side {
    Old,
    New,
}

/// Reconstruct one side of the hunk and remember, for each byte offset
/// in the resulting text, which diff-line index in `hunk.lines` it
/// belongs to. We store this as a per-line `(start_byte, hunk_line_idx)`
/// table so the highlighter output (which speaks in bytes) can be split
/// back across diff lines without re-scanning the string.
fn build_side(lines: &[DiffLine], side: Side) -> (Vec<u8>, Vec<LineSlot>) {
    let mut text = Vec::with_capacity(lines.iter().map(|l| l.content.len() + 1).sum());
    let mut slots = Vec::new();
    for (idx, line) in lines.iter().enumerate() {
        let keep = match (side, line.kind) {
            (Side::Old, LineKind::Add) => false,
            (Side::New, LineKind::Remove) => false,
            _ => true,
        };
        if !keep {
            continue;
        }
        let start = text.len();
        text.extend_from_slice(line.content.as_bytes());
        slots.push(LineSlot {
            byte_start: start,
            byte_end: text.len(),
            line_idx: idx,
        });
        text.push(b'\n');
    }
    (text, slots)
}

#[derive(Debug, Clone, Copy)]
struct LineSlot {
    /// Inclusive byte offset where this diff line begins in `text`.
    byte_start: usize,
    /// Exclusive byte offset where this diff line ends in `text`
    /// (the trailing `\n` is NOT included).
    byte_end: usize,
    /// Index into `hunk.lines` this slot belongs to.
    line_idx: usize,
}

fn highlight_side(
    config: &HighlightConfiguration,
    text: &[u8],
    slots: &[LineSlot],
    per_line: &mut [LineHighlights],
) {
    if text.is_empty() || slots.is_empty() {
        return;
    }

    let mut highlighter = Highlighter::new();
    let events = match highlighter.highlight(config, text, None, |_| None) {
        Ok(it) => it,
        Err(_) => return,
    };

    let palette = palette();
    let mut color_stack: Vec<Hsla> = Vec::with_capacity(8);

    for event in events {
        let Ok(event) = event else { continue };
        match event {
            HighlightEvent::HighlightStart(h) => {
                let color = palette.get(h.0).copied().flatten();
                if let Some(c) = color {
                    color_stack.push(c);
                } else {
                    // Push the parent color so Pop is balanced.
                    let parent = color_stack.last().copied().unwrap_or(Hsla::default());
                    color_stack.push(parent);
                }
            }
            HighlightEvent::HighlightEnd => {
                color_stack.pop();
            }
            HighlightEvent::Source { start, end } => {
                let Some(&color) = color_stack.last() else {
                    continue;
                };
                emit_run(start, end, color, slots, per_line);
            }
        }
    }
}

/// Split a `[start, end)` byte range from the reconstructed side-text
/// across the diff lines it spans. Each line gets a `(line_local_range,
/// color)` entry in `per_line`.
fn emit_run(
    start: usize,
    end: usize,
    color: Hsla,
    slots: &[LineSlot],
    per_line: &mut [LineHighlights],
) {
    if start >= end {
        return;
    }
    // Binary search for the first slot whose end is past `start`.
    let mut i = match slots.binary_search_by(|s| {
        if s.byte_end <= start {
            std::cmp::Ordering::Less
        } else if s.byte_start > start {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    }) {
        Ok(i) | Err(i) => i,
    };
    while i < slots.len() {
        let slot = slots[i];
        if slot.byte_start >= end {
            break;
        }
        let s = start.max(slot.byte_start);
        let e = end.min(slot.byte_end);
        if s < e {
            let local_start = s - slot.byte_start;
            let local_end = e - slot.byte_start;
            per_line[slot.line_idx]
                .runs
                .push((local_start..local_end, color));
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::parse_unified;

    #[test]
    fn detects_languages() {
        assert_eq!(language_from_path("src/lib.rs"), Some(Language::Rust));
        assert_eq!(
            language_from_path("foo/bar/baz.tsx"),
            Some(Language::Tsx)
        );
        assert_eq!(language_from_path("Dockerfile"), Some(Language::Bash));
        assert_eq!(language_from_path("README"), None);
    }

    #[test]
    fn highlights_rust_keywords() {
        let diff = "@@ -1,1 +1,1 @@\n-fn old() {}\n+fn renamed() {}\n";
        let hunks = parse_unified(diff);
        let hl = highlight_hunk(&hunks[0], Language::Rust);
        assert_eq!(hl.per_line.len(), 2);
        // Both lines should produce at least one highlight run — at minimum
        // the `fn` keyword gets a color.
        assert!(
            !hl.per_line[0].runs.is_empty(),
            "expected highlights on the removed line"
        );
        assert!(
            !hl.per_line[1].runs.is_empty(),
            "expected highlights on the added line"
        );
    }
}
