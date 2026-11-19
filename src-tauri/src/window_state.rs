//! Remembers where the main window was and puts it back on the next launch.
//!
//! Without this, every relaunch (an update, switching UIs, a reboot) opened
//! the window at its default size on the primary display.
//!
//! The bounds are written to `window-state.json` in the app config dir,
//! shortly after the window stops moving or resizing, so they survive the app
//! being killed rather than quit (a reboot, an updater relaunch).
//!
//! Units: on macOS the bounds are logical points. AppKit places every display
//! in one global point space, so a point position means the same thing on a
//! Retina laptop screen and a 1x external monitor. Physical pixels don't: tao
//! converts them with the scale factor of whatever screen the window is on at
//! that moment, so a window saved on a 1x monitor would come back at half the
//! position and size while it's still sitting on the 2x primary. Windows and
//! Linux do use one physical pixel space for the desktop, so there the bounds
//! are physical pixels.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, LogicalSize, Manager, Monitor, Runtime, WebviewWindow, Window, WindowEvent,
};

const FILE_NAME: &str = "window-state.json";
/// Wait this long after the last move/resize before writing to disk.
const SAVE_DEBOUNCE: Duration = Duration::from_millis(500);
/// Saved bounds smaller than this are treated as garbage.
const MIN_SANE_SIZE: f64 = 100.0;
/// The strip at the top of the window that has to land on a display for the
/// saved position to be used: enough of the title bar to grab and drag.
const TITLE_BAR_HEIGHT: f64 = 30.0;
const MIN_VISIBLE_TITLE_BAR_WIDTH: f64 = 100.0;

/// A rectangle in platform units (see the module docs).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Rect {
    /// Width and height of the overlap with `other` (zero when they don't touch).
    fn overlap(&self, other: &Rect) -> (f64, f64) {
        let w = (self.x + self.width).min(other.x + other.width) - self.x.max(other.x);
        let h = (self.y + self.height).min(other.y + other.height) - self.y.max(other.y);
        (w.max(0.0), h.max(0.0))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
struct SavedWindowState {
    /// Outer position and inner size of the un-maximized window.
    #[serde(flatten)]
    bounds: Rect,
    maximized: bool,
}

/// Managed state: the latest bounds and where to write them.
struct WindowStateTracker {
    path: Option<PathBuf>,
    state: Mutex<Option<SavedWindowState>>,
    /// Bumped on every change; a pending debounced save only writes if no
    /// newer change has come in since it was scheduled.
    generation: AtomicU64,
}

impl WindowStateTracker {
    fn write(&self) {
        let Some(path) = &self.path else { return };
        // Holding the lock while writing keeps concurrent writes (a debounced
        // save racing the exit save) from clobbering each other's temp file.
        let state = self.state.lock().unwrap();
        let Some(state) = *state else { return };
        if let Err(e) = write_file(path, &state) {
            log::warn!("[window-state] Failed to save {}: {}", path.display(), e);
        }
    }
}

/// Puts `window` back where it was last time, then starts tracking it.
///
/// Call this right after building the window, while it is still hidden, so
/// it never flashes at its default position.
pub fn restore<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    min_inner_size: Option<LogicalSize<f64>>,
) {
    let path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(FILE_NAME));
    let saved = path.as_deref().and_then(read_file);

    if let Some(saved) = saved {
        match apply(window, saved, min_inner_size) {
            Ok(()) => log::info!("[window-state] Restored {:?}", saved),
            Err(e) => log::warn!("[window-state] Failed to restore: {}", e),
        }
    }

    app.manage(WindowStateTracker {
        path,
        state: Mutex::new(saved),
        generation: AtomicU64::new(0),
    });
}

/// Hook for `Builder::on_window_event`: records the main window's bounds as
/// it moves and resizes. Call it before anything that hides the window on
/// close, so the bounds are captured while it's still on screen.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            if capture(window) {
                schedule_save(window.app_handle());
            }
        }
        WindowEvent::CloseRequested { .. } => {
            capture(window);
            save_now(window.app_handle());
        }
        _ => {}
    }
}

/// Writes the latest bounds to disk right away (call on app exit).
pub fn save_now<R: Runtime>(app: &AppHandle<R>) {
    if let Some(tracker) = app.try_state::<WindowStateTracker>() {
        tracker.write();
    }
}

/// How many physical pixels make one stored unit (see the module docs).
fn unit_scale(scale_factor: f64) -> f64 {
    if cfg!(target_os = "macos") {
        scale_factor
    } else {
        1.0
    }
}

fn to_position(x: f64, y: f64) -> tauri::Position {
    if cfg!(target_os = "macos") {
        tauri::LogicalPosition::new(x, y).into()
    } else {
        tauri::PhysicalPosition::new(x.round() as i32, y.round() as i32).into()
    }
}

fn to_size(width: f64, height: f64) -> tauri::Size {
    if cfg!(target_os = "macos") {
        tauri::LogicalSize::new(width, height).into()
    } else {
        tauri::PhysicalSize::new(width.round() as u32, height.round() as u32).into()
    }
}

fn monitor_rect(monitor: &Monitor) -> Rect {
    let scale = unit_scale(monitor.scale_factor());
    let position = monitor.position();
    let size = monitor.size();
    Rect {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    }
}

/// Whether enough of the window's title bar lands on some display to grab it.
/// False when the display it was on has been unplugged.
fn title_bar_visible(bounds: &Rect, monitors: &[Rect]) -> bool {
    let title_bar = Rect {
        height: TITLE_BAR_HEIGHT.min(bounds.height),
        ..*bounds
    };
    let needed = MIN_VISIBLE_TITLE_BAR_WIDTH.min(bounds.width);
    monitors.iter().any(|monitor| {
        let (w, h) = title_bar.overlap(monitor);
        w >= needed && h > 0.0
    })
}

fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    saved: SavedWindowState,
    min_inner_size: Option<LogicalSize<f64>>,
) -> tauri::Result<()> {
    let mut bounds = saved.bounds;
    if !(bounds.width >= MIN_SANE_SIZE && bounds.height >= MIN_SANE_SIZE)
        || !bounds.x.is_finite()
        || !bounds.y.is_finite()
    {
        return Ok(());
    }

    // The other UI may need a bigger window than the one it was saved from.
    if let Some(min) = min_inner_size {
        let scale = window.scale_factor()? / unit_scale(window.scale_factor()?);
        bounds.width = bounds.width.max(min.width * scale);
        bounds.height = bounds.height.max(min.height * scale);
    }

    let monitors: Vec<Rect> = window
        .available_monitors()?
        .iter()
        .map(monitor_rect)
        .collect();
    let size = to_size(bounds.width, bounds.height);

    if title_bar_visible(&bounds, &monitors) {
        // Size first: on macOS a resize keeps the bottom-left corner fixed, so
        // resizing after positioning would shift the top edge.
        window.set_size(size)?;
        window.set_position(to_position(bounds.x, bounds.y))?;
        // On Windows, landing on a display with a different DPI rescales the
        // window, so set the size again once it's there.
        #[cfg(not(target_os = "macos"))]
        window.set_size(size)?;
    } else if monitors
        .iter()
        .any(|m| m.width >= bounds.width && m.height >= bounds.height)
    {
        // The display it was on is gone: keep the size if it still fits
        // somewhere and let the OS pick the position.
        window.set_size(size)?;
    }

    if saved.maximized {
        window.maximize()?;
    }
    Ok(())
}

/// Records the window's current bounds. Returns whether anything changed.
fn capture<R: Runtime>(window: &Window<R>) -> bool {
    let Some(tracker) = window.try_state::<WindowStateTracker>() else {
        return false;
    };
    // Minimized, fullscreen and hidden frames aren't where the window lives;
    // keep the last normal bounds instead. (While it's hidden at startup the
    // restore itself fires these events.)
    if !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(true)
        || window.is_fullscreen().unwrap_or(true)
    {
        return false;
    }

    let current = || -> tauri::Result<Rect> {
        let scale = unit_scale(window.scale_factor()?);
        let position = window.outer_position()?;
        let size = window.inner_size()?;
        Ok(Rect {
            x: position.x as f64 / scale,
            y: position.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        })
    };

    let maximized = window.is_maximized().unwrap_or(false);
    let mut state = tracker.state.lock().unwrap();
    let next = match (maximized, *state) {
        // Keep the un-maximized bounds, so un-maximizing after a relaunch
        // still returns the window to where it was.
        (true, Some(prev)) => SavedWindowState {
            maximized: true,
            ..prev
        },
        _ => match current() {
            Ok(bounds) => SavedWindowState { bounds, maximized },
            Err(_) => return false,
        },
    };

    if *state == Some(next) {
        return false;
    }
    *state = Some(next);
    tracker.generation.fetch_add(1, Ordering::SeqCst);
    true
}

fn schedule_save<R: Runtime>(app: &AppHandle<R>) {
    let Some(tracker) = app.try_state::<WindowStateTracker>() else {
        return;
    };
    let generation = tracker.generation.load(Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_DEBOUNCE).await;
        if let Some(tracker) = app.try_state::<WindowStateTracker>() {
            if tracker.generation.load(Ordering::SeqCst) == generation {
                tracker.write();
            }
        }
    });
}

fn read_file(path: &Path) -> Option<SavedWindowState> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(state) => Some(state),
        Err(e) => {
            log::warn!(
                "[window-state] Ignoring unreadable {}: {}",
                path.display(),
                e
            );
            None
        }
    }
}

fn write_file(path: &Path, state: &SavedWindowState) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Write-then-rename so a crash mid-write can't leave a truncated file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state)?)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, width: f64, height: f64) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    // A 1512x982 laptop screen with a 2560x1440 monitor to its right,
    // top-aligned (macOS point coordinates).
    fn displays() -> Vec<Rect> {
        vec![
            rect(0.0, 0.0, 1512.0, 982.0),
            rect(1512.0, 0.0, 2560.0, 1440.0),
        ]
    }

    #[test]
    fn window_on_external_monitor_is_visible() {
        assert!(title_bar_visible(
            &rect(2000.0, 100.0, 1400.0, 900.0),
            &displays()
        ));
    }

    #[test]
    fn window_on_unplugged_monitor_is_not_visible() {
        let laptop_only = vec![rect(0.0, 0.0, 1512.0, 982.0)];
        assert!(!title_bar_visible(
            &rect(2000.0, 100.0, 1400.0, 900.0),
            &laptop_only
        ));
    }

    #[test]
    fn window_spanning_displays_is_visible() {
        assert!(title_bar_visible(
            &rect(1400.0, 50.0, 800.0, 600.0),
            &displays()
        ));
    }

    #[test]
    fn title_bar_above_every_display_is_not_visible() {
        // Only the bottom of the window is on screen; the title bar isn't.
        assert!(!title_bar_visible(
            &rect(100.0, -500.0, 800.0, 600.0),
            &displays()
        ));
    }

    #[test]
    fn sliver_of_title_bar_is_not_enough() {
        // 20pt of title bar peeking in from the left edge.
        assert!(!title_bar_visible(
            &rect(-780.0, 100.0, 800.0, 600.0),
            &displays()
        ));
    }

    #[test]
    fn display_left_of_primary_has_negative_coordinates() {
        let left_monitor = vec![
            rect(-1920.0, 0.0, 1920.0, 1080.0),
            rect(0.0, 0.0, 1512.0, 982.0),
        ];
        assert!(title_bar_visible(
            &rect(-1700.0, 200.0, 1200.0, 800.0),
            &left_monitor
        ));
    }

    #[test]
    fn state_round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join(FILE_NAME);
        let state = SavedWindowState {
            bounds: rect(1700.5, 40.0, 1400.0, 900.0),
            maximized: true,
        };
        write_file(&path, &state).unwrap();
        assert_eq!(read_file(&path), Some(state));
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn unreadable_file_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, b"{ not json").unwrap();
        assert_eq!(read_file(&path), None);
        assert_eq!(read_file(&dir.path().join("missing.json")), None);
    }
}
