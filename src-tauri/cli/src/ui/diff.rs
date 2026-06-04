//! Render a single file's unified diff as syntax-highlighted ratatui Text.

use crate::syntax::Highlighter;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::text::Text;
use ultra_gitlab_lib::commands::mr::parse_unified_diff_public;

const ADD_BG: Color = Color::Rgb(20, 48, 28);
const DEL_BG: Color = Color::Rgb(56, 24, 24);
const GUTTER: Color = Color::DarkGray;
/// Spaces per tab stop. Diff content is expanded before rendering because a
/// literal `\t` advances a real terminal's cursor to the next tab stop while
/// ratatui counts it as one cell — the desync pushes the rest of the line past
/// the pane's right border (the diff "bleeds out of its box").
const TAB_WIDTH: usize = 4;

/// Build highlighted, scrollable Text for a file's unified diff.
/// `path` selects the syntax; `diff_content` is the raw unified diff.
pub fn render_diff<'a>(hl: &Highlighter, path: &str, diff_content: &str) -> Text<'a> {
    let hunks = parse_unified_diff_public(diff_content);

    // Highlight each line's content independently against the file syntax —
    // adequate for v1 and avoids tracking two file sides.
    let mut lines: Vec<Line> = Vec::new();
    for hunk in &hunks {
        lines.push(Line::from(Span::styled(
            format!("@@ -{},{} +{},{} @@", hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count),
            Style::default().fg(Color::Cyan),
        )));
        for dl in &hunk.lines {
            let (bg, sign, old_n, new_n) = match dl.line_type.as_str() {
                "add" => (Some(ADD_BG), "+", None, dl.new_line_number),
                "remove" => (Some(DEL_BG), "-", dl.old_line_number, None),
                _ => (None, " ", dl.old_line_number, dl.new_line_number),
            };
            let gutter = format!(
                "{:>4} {:>4} ",
                old_n.map(|n| n.to_string()).unwrap_or_default(),
                new_n.map(|n| n.to_string()).unwrap_or_default(),
            );
            let mut spans = vec![
                Span::styled(gutter, Style::default().fg(GUTTER)),
                Span::styled(sign.to_string(), line_style(bg)),
            ];
            let content = expand_tabs(&dl.content);
            for seg in hl.highlight(path, &content).into_iter().next().unwrap_or_default() {
                let mut style = Style::default().fg(seg.color);
                if let Some(bg) = bg {
                    style = style.bg(bg);
                }
                spans.push(Span::styled(seg.text, style));
            }
            lines.push(Line::from(spans));
        }
        lines.push(Line::from(""));
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no textual diff — binary or empty)",
            Style::default().fg(Color::DarkGray),
        )));
    }
    Text::from(lines)
}

/// Expand tab characters to spaces, aligning to the next `TAB_WIDTH` stop so a
/// real terminal renders the same cell count ratatui laid out. Other control
/// characters are left untouched.
fn expand_tabs(s: &str) -> String {
    if !s.contains('\t') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + TAB_WIDTH);
    let mut col = 0;
    for ch in s.chars() {
        if ch == '\t' {
            let pad = TAB_WIDTH - (col % TAB_WIDTH);
            out.extend(std::iter::repeat(' ').take(pad));
            col += pad;
        } else {
            out.push(ch);
            col += 1;
        }
    }
    out
}

fn line_style(bg: Option<Color>) -> Style {
    let mut s = Style::default();
    if let Some(bg) = bg {
        s = s.bg(bg);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_hunk_lines() {
        let hl = Highlighter::new();
        let diff = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
        let text = render_diff(&hl, "x.rs", diff);
        // hunk header + 3 body lines + trailing blank
        assert!(text.lines.len() >= 4);
    }

    #[test]
    fn expand_tabs_aligns_to_stops() {
        assert_eq!(expand_tabs("\tx"), "    x");
        assert_eq!(expand_tabs("ab\tx"), "ab  x"); // 2 chars → pad 2 to reach col 4
        assert_eq!(expand_tabs("\t\tx"), "        x");
        assert_eq!(expand_tabs("no tabs"), "no tabs");
    }

    #[test]
    fn rendered_diff_has_no_literal_tabs() {
        let hl = Highlighter::new();
        let diff = "@@ -1,1 +0,0 @@\n-\t\t<label>\n";
        let text = render_diff(&hl, "x.html", diff);
        for line in &text.lines {
            for span in &line.spans {
                assert!(!span.content.contains('\t'), "tab leaked into rendered span");
            }
        }
    }

    #[test]
    fn empty_diff_shows_placeholder() {
        let hl = Highlighter::new();
        let text = render_diff(&hl, "x.bin", "");
        let s: String = text.lines[0].spans.iter().map(|sp| sp.content.as_ref()).collect();
        assert!(s.contains("no textual diff"));
    }
}
