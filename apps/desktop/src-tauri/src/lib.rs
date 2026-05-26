// DayRail desktop · runtime library.
//
// As of PR-C: shell + auto-update + desktop OAuth Drive auth wired.
// The frontend invokes the `drive_*` commands instead of going
// through GIS implicit flow when running in Tauri (ERD §15.3).
//
// v0.11.6: autostart at login + post-update foregrounding (ERD §15.8).
// Launch source is signaled via CLI args / env vars set by either the
// autostart plugin (`--autostart` arg in the registered launch entry)
// or the `relaunch_for_update` command (sets `DAYRAIL_RESTART_REASON=
// update` before `app.restart()`). The setup hook reads both and
// decides whether to hide the window (autostart) or force foreground
// (post-update relaunch).

mod backup;
mod drive_auth;
mod system_info;
mod update_cleanup;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

const RESTART_REASON_ENV: &str = "DAYRAIL_RESTART_REASON";
const RESTART_REASON_UPDATE: &str = "update";
const AUTOSTART_ARG: &str = "--autostart";

/// Restart the app after an updater install, signalling the new
/// process that it should foreground itself instead of inheriting
/// macOS's default "stay hidden behind whatever the user is doing"
/// behavior for relaunched processes (ERD §15.8). `std::env::set_var`
/// here propagates to the child via `Command::spawn` inheritance,
/// which `app.restart()` uses under the hood.
#[tauri::command]
fn relaunch_for_update(app: tauri::AppHandle) {
    std::env::set_var(RESTART_REASON_ENV, RESTART_REASON_UPDATE);
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ERD §15.9 — restore the window's last geometry on launch and
        // save it on exit. Covers size, position (which monitor the
        // window lands on is just its saved x/y), maximized, and
        // fullscreen. VISIBLE is deliberately excluded: the autostart
        // path (§15.8) hides the window at boot, and persisting that
        // would make a subsequent normal launch start hidden too.
        // DECORATIONS is excluded as well — we never toggle them, so
        // the config default should always win.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED
                        | tauri_plugin_window_state::StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        // ERD §15.x — native file picker + filesystem read for `.dryj`
        // import. WKWebView's HTML5 file input silently drops the
        // file's bytes (encountered during the v0.9.0→v0.9.1 recovery);
        // the native dialog returns a path that we read via plugin-fs.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // ERD §15.4 — auto-update. Endpoint URL + public key live in
        // `tauri.conf.json` under plugins.updater. The frontend
        // initiates checks via the JS SDK; this `init()` exposes the
        // IPC bridge.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // `tauri-plugin-process` provides `relaunch()` to the
        // frontend; the updater calls it after install to land users
        // on the new version cleanly. v0.11.6 routes through our
        // `relaunch_for_update` command instead so we can set the
        // restart-reason env var first (ERD §15.8).
        .plugin(tauri_plugin_process::init())
        // ERD §15.8 — autostart at login. Args are appended to the
        // registered launch entry (Launch Agent / Run registry /
        // .desktop), so a launch from that path arrives with
        // `--autostart` in argv — the setup hook below reads this to
        // decide whether to hide the main window.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
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
            system_info::get_system_info,
            backup::backup_save,
            backup::backup_list,
            backup::backup_read,
            backup::backup_delete,
            backup::backup_export_to,
            backup::backup_default_dir,
            relaunch_for_update,
        ])
        .setup(|app| {
            // ERD §15.11 — clean up orphaned auto-update temp bundles
            // from previous sessions (incl. the update we just applied,
            // whose relaunch lands here). Background thread so a slow
            // temp-dir scan never delays first paint.
            std::thread::spawn(update_cleanup::sweep_stale_update_artifacts);

            // ERD §15.8 launch-source detection.
            //
            // Two independent signals; both checked because they can
            // arrive together in the theoretical autostart + update
            // overlap case (update wins → foreground).
            let argv: Vec<String> = std::env::args().collect();
            let is_autostart = argv.iter().any(|a| a == AUTOSTART_ARG);
            let is_update_restart = std::env::var(RESTART_REASON_ENV)
                .map(|v| v == RESTART_REASON_UPDATE)
                .unwrap_or(false);

            // Clear the env var so any subsequent user-initiated
            // restart (e.g. crash recovery later in the session)
            // doesn't inherit the update signal.
            if is_update_restart {
                std::env::remove_var(RESTART_REASON_ENV);
            }

            if let Some(window) = app.get_webview_window("main") {
                if is_update_restart {
                    // Post-update: force foreground regardless of
                    // autostart status (update intent is explicit).
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                } else if is_autostart {
                    // Autostart with no update reason → hide; user
                    // surfaces the window by clicking the dock icon.
                    let _ = window.hide();
                }
                // Other paths (dock click, Finder, dev) → leave
                // tauri's default show() behavior in place.
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running DayRail desktop");
}
