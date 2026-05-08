// DayRail desktop · runtime library.
//
// As of PR-C: shell + auto-update + desktop OAuth Drive auth wired.
// The frontend invokes the `drive_*` commands instead of going
// through GIS implicit flow when running in Tauri (ERD §15.3).

mod drive_auth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        // ERD §15.3 — desktop Drive auth commands. Keep the OAuth
        // flow + keychain access in Rust so the refresh token never
        // crosses the IPC boundary; the frontend only sees fresh
        // access tokens it can drop straight into Authorization
        // headers.
        .invoke_handler(tauri::generate_handler![
            drive_auth::drive_connect,
            drive_auth::drive_get_token,
            drive_auth::drive_disconnect,
            drive_auth::drive_is_connected,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DayRail desktop");
}
