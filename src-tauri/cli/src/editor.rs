//! Compose text in the user's $EDITOR by suspending and restoring the TUI.

use std::io::{self, Write};

/// Decide the result body from raw editor output: strip lines starting with `#`,
/// trim, and treat an empty result as a cancel (`None`). Pure so it is testable.
fn finalize_body(raw: &str) -> Option<String> {
    let kept: Vec<&str> = raw
        .lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .collect();
    let body = kept.join("\n").trim().to_string();
    if body.is_empty() {
        None
    } else {
        Some(body)
    }
}

#[cfg(test)]
mod tests {
    use super::finalize_body;

    #[test]
    fn strips_comment_lines_and_trims() {
        assert_eq!(
            finalize_body("# banner\nhello\n\n# tail\n").as_deref(),
            Some("hello")
        );
    }

    #[test]
    fn empty_is_cancel() {
        assert_eq!(finalize_body("# only banner\n   \n"), None);
    }

    #[test]
    fn keeps_code_with_hash_inside() {
        assert_eq!(finalize_body("let x = \"#fff\";").as_deref(), Some("let x = \"#fff\";"));
    }
}

use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};

/// Suspend the TUI, open `seed` in $EDITOR (temp file named with `ext`), restore
/// the TUI, and return the finalized body (`None` = cancelled / empty).
///
/// `strip_comments` controls whether `#`-prefixed lines are dropped: true for
/// comment/reply bodies (which carry a `#` banner), false for suggestion seeds
/// (which are real source that may legitimately start with `#`).
pub fn compose(seed: &str, ext: &str, strip_comments: bool) -> io::Result<Option<String>> {
    let mut path = std::env::temp_dir();
    let pid = std::process::id();
    path.push(format!("ultra-comment-{pid}.{ext}"));
    {
        let mut f = std::fs::File::create(&path)?;
        f.write_all(seed.as_bytes())?;
    }

    // Leave the alternate screen so the editor owns the terminal.
    disable_raw_mode()?;
    crossterm::execute!(io::stdout(), LeaveAlternateScreen)?;

    let editor = std::env::var("VISUAL")
        .or_else(|_| std::env::var("EDITOR"))
        .unwrap_or_else(|_| if cfg!(windows) { "notepad".into() } else { "vi".into() });
    let status = std::process::Command::new(&editor).arg(&path).status();

    // Re-enter the alternate screen for the TUI.
    enable_raw_mode()?;
    crossterm::execute!(io::stdout(), EnterAlternateScreen)?;

    status?; // propagate spawn/wait errors after restoring the terminal

    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    Ok(if strip_comments {
        finalize_body(&raw)
    } else {
        let t = raw.trim_end_matches('\n').to_string();
        if t.trim().is_empty() { None } else { Some(t) }
    })
}
