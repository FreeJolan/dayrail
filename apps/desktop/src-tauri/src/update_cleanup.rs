// ERD §15.11 — sweep orphaned auto-update temp artifacts at launch.
//
// tauri-plugin-updater downloads the new build (.app.tar.gz) into
// memory and extracts it into temp directories under
// `std::env::temp_dir()`:
//
//   - macOS / Linux: `tauri_updated_app*` (the freshly extracted .app)
//     and `tauri_current_app*` (the replaced old .app, held as a
//     rollback point during the swap).
//   - Windows: `DayRail-<version>-updater-*` and
//     `DayRail-<version>-installer*`.
//
// On a clean install these are RAII-cleaned when the install function
// returns. But an interrupted download or a forced restart can orphan
// them — and each can hold a full app bundle (tens of MB), so they
// accumulate. These directories are never re-read across launches, so
// anything matching the updater's own naming at startup is safe to
// delete.
//
// Timing: we sweep on launch (a background thread spawned from the
// setup hook). It runs before this session triggers any update, so it
// only ever sees leftovers from *previous* sessions — including the
// just-applied update, whose post-install relaunch lands us back in
// this exact code path. Best-effort; failures are ignored.

use std::path::Path;

/// Fixed temp-dir prefixes the updater uses on macOS / Linux.
const STATIC_PREFIXES: &[&str] = &["tauri_updated_app", "tauri_current_app"];

/// Scan `std::env::temp_dir()` and remove any orphaned updater
/// artifacts. Safe to call on every launch.
pub fn sweep_stale_update_artifacts() {
    let tmp = std::env::temp_dir();
    let entries = match std::fs::read_dir(&tmp) {
        Ok(e) => e,
        Err(_) => return,
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if is_updater_artifact(&name) && remove_path(&entry.path()) {
            removed += 1;
        }
    }
    if removed > 0 {
        eprintln!(
            "[update-cleanup] removed {removed} stale updater artifact(s) from {}",
            tmp.display()
        );
    }
}

/// True only for names the updater itself generates — never for
/// unrelated temp files. This is the guard that keeps the sweep from
/// touching anything else in the shared temp directory.
fn is_updater_artifact(name: &str) -> bool {
    if STATIC_PREFIXES.iter().any(|p| name.starts_with(p)) {
        return true;
    }
    // Windows installer/updater temp names embed the product name.
    name.starts_with("DayRail-")
        && (name.contains("-updater") || name.contains("-installer"))
}

fn remove_path(path: &Path) -> bool {
    let res = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    res.is_ok()
}
