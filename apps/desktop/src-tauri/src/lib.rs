// DayRail desktop · runtime library.
//
// As of PR-B: shell + auto-update wired. Sync-layer adaptation
// (PR-C) still pending — Drive auth still uses the web's GIS
// implicit flow until that lands.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // `tauri-plugin-shell` is opt-in and gated by capabilities
        // (see `capabilities/default.json`). PR-C will use it to open
        // the OAuth consent URL in the user's default browser when we
        // switch sync to the desktop OAuth pattern (ERD §15.3).
        .plugin(tauri_plugin_shell::init())
        // ERD §15.4 — auto-update. Endpoint URL + public key live in
        // `tauri.conf.json` under plugins.updater. The frontend
        // initiates checks via the JS SDK; this `init()` exposes the
        // IPC bridge.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // `tauri-plugin-process` provides `relaunch()` to the
        // frontend; the updater calls it after install to land users
        // on the new version cleanly.
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running DayRail desktop");
}
