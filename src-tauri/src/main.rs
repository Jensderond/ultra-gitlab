// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "tauri-app")]
fn main() {
    ultra_gitlab_lib::run()
}

#[cfg(not(feature = "tauri-app"))]
fn main() {
    // The `ultra-gitlab` binary is the Tauri desktop app. When the crate
    // is consumed as a library without the `tauri-app` feature (e.g. by
    // the GPUI experiment), the binary is a no-op stub so that
    // `cargo check --no-default-features` keeps working.
    eprintln!("ultra-gitlab binary requires the `tauri-app` feature");
    std::process::exit(1);
}
