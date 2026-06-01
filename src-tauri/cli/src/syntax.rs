//! Thin syntect wrapper: turn a file's lines into per-line styled segments.

use ratatui::style::Color;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Style as SynStyle, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

/// A piece of text with a foreground color.
#[derive(Debug, Clone)]
pub struct Segment {
    pub text: String,
    pub color: Color,
}

pub struct Highlighter {
    syntaxes: SyntaxSet,
    themes: ThemeSet,
}

impl Highlighter {
    pub fn new() -> Self {
        Highlighter {
            syntaxes: SyntaxSet::load_defaults_newlines(),
            themes: ThemeSet::load_defaults(),
        }
    }

    /// Highlight whole source text, returning one Vec<Segment> per line.
    /// `path` selects the syntax by file extension; unknown → plain text.
    pub fn highlight(&self, path: &str, source: &str) -> Vec<Vec<Segment>> {
        let theme = &self.themes.themes["base16-eighties.dark"];
        let ext = path.rsplit('.').next().unwrap_or("");
        let syntax = self
            .syntaxes
            .find_syntax_by_extension(ext)
            .unwrap_or_else(|| self.syntaxes.find_syntax_plain_text());
        let mut hl = HighlightLines::new(syntax, theme);

        let mut out = Vec::new();
        for line in LinesWithEndings::from(source) {
            let ranges: Vec<(SynStyle, &str)> =
                hl.highlight_line(line, &self.syntaxes).unwrap_or_default();
            let segs = ranges
                .into_iter()
                .map(|(style, text)| Segment {
                    text: text.trim_end_matches('\n').to_string(),
                    color: Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b),
                })
                .collect();
            out.push(segs);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlights_rust_into_lines() {
        let hl = Highlighter::new();
        let lines = hl.highlight("main.rs", "fn main() {}\nlet x = 1;\n");
        assert_eq!(lines.len(), 2);
        assert!(!lines[0].is_empty());
    }

    #[test]
    fn unknown_extension_is_plain() {
        let hl = Highlighter::new();
        let lines = hl.highlight("notes.unknownext", "hello world\n");
        assert_eq!(lines.len(), 1);
        let text: String = lines[0].iter().map(|s| s.text.as_str()).collect();
        assert_eq!(text, "hello world");
    }
}
