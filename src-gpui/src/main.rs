//! Ultra GitLab — GPUI frontend experiment.
//!
//! Loads merge requests from the same SQLite cache that the Tauri app
//! writes to, starts the same background sync engine, and renders an MR
//! list with [`longbridge/gpui-component`]'s widgets. See `README.md`
//! for the motivation and the wiring diagram.

mod backend;
mod view;

use gpui::{px, size, AppContext, KeyBinding, WindowBounds, WindowOptions};
use gpui_component::{Root, Theme, ThemeMode, TitleBar};

use backend::{resolve_db_path, Backend};
use view::{MrListView, Quit};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_millis()
        .init();

    let db_path = resolve_db_path();
    log::info!("Opening SQLite at {}", db_path.display());

    let backend = Backend::start(db_path).expect("failed to start backend");

    let app = gpui_platform::application();

    app.run(move |cx| {
        gpui_component::init(cx);

        cx.bind_keys([
            #[cfg(target_os = "macos")]
            KeyBinding::new("cmd-q", Quit, None),
            #[cfg(not(target_os = "macos"))]
            KeyBinding::new("ctrl-q", Quit, None),
        ]);

        cx.on_action(|_: &Quit, cx: &mut gpui::App| cx.quit());

        let window_options = WindowOptions {
            titlebar: Some(TitleBar::title_bar_options()),
            window_bounds: Some(WindowBounds::centered(size(px(1100.), px(720.)), cx)),
            ..Default::default()
        };

        let backend = backend.clone();
        cx.spawn(async move |cx| {
            cx.open_window(window_options, |window, cx| {
                window.activate_window();
                window.set_window_title("Ultra GitLab (GPUI experiment)");

                Theme::change(ThemeMode::Dark, Some(window), cx);

                let view = cx.new(|cx| MrListView::new(backend.clone(), window, cx));
                cx.new(|cx| Root::new(view, window, cx))
            })
            .expect("Failed to open window");
        })
        .detach();
    });
}
