// DayRail desktop · runtime library.
//
// PR-A scope: minimal Tauri 2 shell that loads the existing web
// frontend (`apps/web/dist`) into a system webview. No sync-layer
// adaptation, no auto-update — those land in PR-C and PR-B
// respectively (ERD §15.3 / §15.4).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // `tauri-plugin-shell` is opt-in and gated by capabilities
        // (see `capabilities/default.json`). PR-C will use it to open
        // the OAuth consent URL in the user's default browser when we
        // switch sync to the desktop OAuth pattern (ERD §15.3).
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running DayRail desktop");
}
