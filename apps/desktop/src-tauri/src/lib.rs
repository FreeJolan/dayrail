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

mod agent_bridge;
mod backup;
mod drive_auth;
mod system_info;
mod update_cleanup;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const RESTART_REASON_ENV: &str = "DAYRAIL_RESTART_REASON";
const RESTART_REASON_UPDATE: &str = "update";
const AUTOSTART_ARG: &str = "--autostart";
const MAIN_WINDOW_LABEL: &str = "main";

/// Window-geometry flags persisted + restored by tauri-plugin-window-state
/// (ERD §15.11). Single source of truth so the save-before-restart in
/// `relaunch_for_update` can't drift from the plugin registration.
fn persisted_window_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

/// Show the main window and promote it to the foreground. Used by
/// explicit foreground intents: post-update relaunch and macOS Dock
/// reopen after an autostart-hidden launch.
fn show_and_focus_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
    } else {
        let Some(config) = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == MAIN_WINDOW_LABEL)
        else {
            return Ok(());
        };

        tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
    };

    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

/// Durable atomic write for the Y.Doc store files (ERD §7.9).
///
/// `tauri-plugin-fs`'s JS `writeFile` + `rename` pair never fsyncs
/// (write_file_inner only `write_all`s; rename is a bare
/// `std::fs::rename`), so on power loss the rename's metadata change
/// can hit the journal before the tmp file's data blocks hit disk —
/// leaving a 0-byte / truncated `state.dryj` under the final name and
/// violating the YDocStore "interrupted write leaves the previous
/// bytes intact" contract. This command owns the full durability
/// dance on the Rust side:
///
///   write unique tmp → fsync(file) → rename → fsync(parent dir)
///
/// The tmp name embeds a UUID so two webview windows can never share
/// (and mutually truncate) a fixed `.tmp` path. `rel_path` is
/// resolved against `app_data_dir()` and strictly validated — no
/// absolute paths, no `..`, no backslashes — so a compromised webview
/// can't use this as an arbitrary-file-write primitive.
#[tauri::command]
fn ydoc_atomic_write(
    app: tauri::AppHandle,
    rel_path: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    atomic_write_under(&base, &rel_path, &bytes)
}

/// Reject anything that could escape `base`: absolute paths, drive /
/// root prefixes, `.` / `..` components, and backslash separators
/// (which `Path::components` would treat as literal file-name bytes
/// on Unix but as separators on Windows).
fn validate_rel_path(rel_path: &str) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    if rel_path.is_empty() || rel_path.contains('\\') {
        return Err(format!("invalid rel_path: {:?}", rel_path));
    }
    let path = std::path::Path::new(rel_path);
    let mut out = std::path::PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Normal(c) => out.push(c),
            _ => return Err(format!("invalid rel_path: {:?}", rel_path)),
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("invalid rel_path: {:?}", rel_path));
    }
    Ok(out)
}

fn atomic_write_under(
    base: &std::path::Path,
    rel_path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use std::io::Write;
    let rel = validate_rel_path(rel_path)?;
    let final_path = base.join(&rel);
    let parent = final_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| base.to_path_buf());
    std::fs::create_dir_all(&parent).map_err(|e| format!("create dir: {}", e))?;
    let file_name = final_path
        .file_name()
        .ok_or_else(|| format!("invalid rel_path: {:?}", rel_path))?
        .to_string_lossy()
        .to_string();
    let tmp = parent.join(format!("{}.{}.tmp", file_name, uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        // Data blocks must be on disk BEFORE the rename's metadata
        // change, otherwise the classic APFS/ext4 reorder leaves a
        // 0-byte file under the final name after a power cut.
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, &final_path)?;
        // Persist the rename itself: fsync the parent directory so
        // the directory-entry update is durable too. Unix-only —
        // Windows can't open a directory as a File, and the reorder
        // this guards against is a POSIX-filesystem behavior.
        #[cfg(unix)]
        {
            std::fs::File::open(&parent)?.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        // Best-effort: don't leave a dangling tmp file behind.
        let _ = std::fs::remove_file(&tmp);
    }
    result.map_err(|e| format!("atomic write {}: {}", rel_path, e))
}

/// Restart the app after an updater install, signalling the new
/// process that it should foreground itself instead of inheriting
/// macOS's default "stay hidden behind whatever the user is doing"
/// behavior for relaunched processes (ERD §15.8). `std::env::set_var`
/// here propagates to the child via `Command::spawn` inheritance,
/// which `app.restart()` uses under the hood.
#[tauri::command]
fn relaunch_for_update(app: tauri::AppHandle) {
    // ERD §15.11 — persist window geometry NOW. The plugin only writes
    // to disk on WindowEvent::CloseRequested / RunEvent::Exit, and
    // `app.restart()` below does NOT emit RunEvent::Exit — so without
    // this explicit save the post-update window forgets its size /
    // position and snaps back to the tauri.conf default. (Regression
    // from when window-state landed in v0.14.0.)
    let _ = app.save_window_state(persisted_window_flags());
    std::env::set_var(RESTART_REASON_ENV, RESTART_REASON_UPDATE);
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(agent_bridge::AgentBridge::default())
        // ERD §15.11 — restore the window's last geometry on launch and
        // save it on exit. Covers size, position (which monitor the
        // window lands on is just its saved x/y), maximized, and
        // fullscreen. VISIBLE is deliberately excluded: the autostart
        // path (§15.8) hides the window at boot, and persisting that
        // would make a subsequent normal launch start hidden too.
        // DECORATIONS is excluded as well — we never toggle them, so
        // the config default should always win.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(persisted_window_flags())
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
            agent_bridge::agent_start,
            agent_bridge::agent_stop,
            agent_bridge::agent_respond,
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
            ydoc_atomic_write,
            relaunch_for_update,
        ])
        .setup(|app| {
            // ERD §15.13 — clean up orphaned auto-update temp bundles
            // from previous sessions (incl. the update we just applied,
            // whose relaunch lands here). Background thread so a slow
            // temp-dir scan never delays first paint. The bundle
            // identifier from tauri.conf.json is the ownership signal
            // for the generic macOS updater temp dirs.
            let bundle_identifier = app.config().identifier.clone();
            std::thread::spawn(move || {
                update_cleanup::sweep_stale_update_artifacts(&bundle_identifier)
            });

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

            if is_update_restart {
                // Post-update: force foreground regardless of
                // autostart status (update intent is explicit).
                let _ = show_and_focus_main_window(app.handle());
            } else if is_autostart {
                if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                    // Autostart with no update reason → hide; user
                    // surfaces the window by clicking the dock icon.
                    let _ = window.hide();
                }
            }
            // Other paths (dock click, Finder, dev) → leave
            // tauri's default show() behavior in place.
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DayRail desktop")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    let _ = show_and_focus_main_window(app_handle);
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Unique scratch dir per test under the real temp dir, cleaned up
    /// by the Drop guard (same pattern as backup.rs).
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "dayrail-ydoc-write-test-{}-{}",
                tag,
                uuid::Uuid::new_v4()
            ));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn list_names(dir: &Path) -> Vec<String> {
        match fs::read_dir(dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    #[test]
    fn atomic_write_creates_dirs_lands_bytes_and_leaves_no_tmp() {
        let scratch = Scratch::new("happy");
        atomic_write_under(scratch.path(), "ydoc/state.dryj", b"snapshot-bytes").unwrap();
        let final_path = scratch.path().join("ydoc").join("state.dryj");
        assert_eq!(fs::read(&final_path).unwrap(), b"snapshot-bytes");
        let leftovers: Vec<String> = list_names(&scratch.path().join("ydoc"))
            .into_iter()
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "stale tmp files: {:?}", leftovers);
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let scratch = Scratch::new("replace");
        atomic_write_under(scratch.path(), "ydoc/state.dryj", b"first").unwrap();
        atomic_write_under(scratch.path(), "ydoc/state.dryj", b"second").unwrap();
        let final_path = scratch.path().join("ydoc").join("state.dryj");
        assert_eq!(fs::read(&final_path).unwrap(), b"second");
    }

    #[test]
    fn atomic_write_rejects_escaping_paths() {
        let scratch = Scratch::new("escape");
        for rel in [
            "",
            "..",
            "../evil.dryj",
            "ydoc/../../evil.dryj",
            "/etc/evil.dryj",
            "./ydoc/state.dryj",
            "ydoc\\state.dryj",
        ] {
            let err = atomic_write_under(scratch.path(), rel, b"x")
                .expect_err(&format!("{:?} must be rejected", rel));
            assert!(err.contains("invalid rel_path"), "{:?} → {}", rel, err);
        }
        // Nothing may have been written anywhere in the scratch dir.
        assert!(list_names(scratch.path()).is_empty());
    }

    #[test]
    fn validate_rel_path_accepts_plain_nested_names() {
        assert_eq!(
            validate_rel_path("ydoc-dev/sync-meta.json").unwrap(),
            PathBuf::from("ydoc-dev").join("sync-meta.json")
        );
    }
}
