// ERD §15.13 — sweep orphaned auto-update temp artifacts at launch.
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
// accumulate. Best-effort; failures are ignored.
//
// Safety guards (the temp dir is shared by the whole user session, so
// prefix-matching alone is NOT enough to claim an entry):
//
//   1. Ownership — the `tauri_updated_app*` / `tauri_current_app*`
//      prefixes are generic tauri-plugin-updater names used by *every*
//      Tauri app on the machine. We only remove such a directory when
//      it contains our own bundle (an entry named `DayRail*` /
//      `dayrail*`). Another Tauri app's in-flight update artifacts are
//      never touched. The Windows names embed our product name, which
//      already identifies them as ours.
//   2. Age — only entries whose mtime is at least MIN_ORPHAN_AGE old
//      are removed. A concurrently running DayRail instance mid-update
//      (its artifacts are seconds old) is never raced. The cost is that
//      the leftovers of a just-applied update survive until a launch
//      ≥ 1 h later — a few tens of MB for a short while, in exchange
//      for never deleting an in-progress install.

use std::path::Path;
use std::time::{Duration, SystemTime};

/// Fixed temp-dir prefixes the updater uses on macOS / Linux. Generic —
/// shared with every other Tauri app — so they additionally require the
/// ownership check in `dir_contains_our_bundle`.
const STATIC_PREFIXES: &[&str] = &["tauri_updated_app", "tauri_current_app"];

/// How old (mtime) an artifact must be before we consider it orphaned
/// rather than part of an install that's still running.
const MIN_ORPHAN_AGE: Duration = Duration::from_secs(60 * 60);

/// Scan `std::env::temp_dir()` and remove any orphaned updater
/// artifacts that are confirmed ours. Safe to call on every launch.
pub fn sweep_stale_update_artifacts() {
    let tmp = std::env::temp_dir();
    let removed = sweep_dir(&tmp, SystemTime::now());
    if removed > 0 {
        eprintln!(
            "[update-cleanup] removed {removed} stale updater artifact(s) from {}",
            tmp.display()
        );
    }
}

fn sweep_dir(tmp: &Path, now: SystemTime) -> usize {
    let entries = match std::fs::read_dir(tmp) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if should_remove(&path, &name, now) && remove_path(&path) {
            removed += 1;
        }
    }
    removed
}

/// True only for entries that (a) match an updater naming pattern,
/// (b) are confirmed to belong to DayRail, and (c) are old enough to
/// be orphans rather than a live install.
fn should_remove(path: &Path, name: &str, now: SystemTime) -> bool {
    let matches = if STATIC_PREFIXES.iter().any(|p| name.starts_with(p)) {
        // Generic updater prefix — claim it only if our bundle is inside.
        dir_contains_our_bundle(path)
    } else {
        is_windows_updater_artifact(name)
    };
    matches && is_older_than(path, now, MIN_ORPHAN_AGE)
}

/// Windows installer/updater temp names embed the product name, so the
/// name alone identifies the artifact as ours.
fn is_windows_updater_artifact(name: &str) -> bool {
    name.starts_with("DayRail-") && (name.contains("-updater") || name.contains("-installer"))
}

/// Ownership probe for the generic macOS/Linux prefixes: the extracted
/// (or swapped-out) bundle inside is named after the product —
/// `DayRail.app` on macOS, `DayRail*.AppImage`-style on Linux. A
/// directory holding another app's bundle (or anything unreadable)
/// is not ours to delete.
fn dir_contains_our_bundle(path: &Path) -> bool {
    let entries = match std::fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return false,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy().to_ascii_lowercase();
        if name.starts_with("dayrail") {
            return true;
        }
    }
    false
}

/// mtime-based age gate. Unreadable metadata or a future mtime (clock
/// weirdness) both fail safe: not old enough, keep the entry.
fn is_older_than(path: &Path, now: SystemTime, min_age: Duration) -> bool {
    let modified = match std::fs::symlink_metadata(path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return false,
    };
    match now.duration_since(modified) {
        Ok(age) => age >= min_age,
        Err(_) => false,
    }
}

fn remove_path(path: &Path) -> bool {
    let res = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    res.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Unique scratch dir per test under the real temp dir. Cleaned up
    /// by the returned guard.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "dayrail-update-cleanup-test-{}-{}",
                tag,
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// `now` far enough in the future that anything created during the
    /// test passes the age gate.
    fn future_now() -> SystemTime {
        SystemTime::now() + MIN_ORPHAN_AGE + Duration::from_secs(60)
    }

    #[test]
    fn windows_updater_names_match_only_our_product() {
        assert!(is_windows_updater_artifact("DayRail-0.16.4-updater-abc"));
        assert!(is_windows_updater_artifact("DayRail-0.16.4-installer.exe"));
        assert!(!is_windows_updater_artifact("OtherApp-1.0-updater-abc"));
        assert!(!is_windows_updater_artifact("DayRail-notes.txt"));
        assert!(!is_windows_updater_artifact("tauri_updated_app-xyz"));
    }

    #[test]
    fn generic_prefix_dir_with_our_bundle_is_removed_when_old() {
        let scratch = Scratch::new("ours");
        let dir = scratch.path().join("tauri_updated_app-abc123");
        std::fs::create_dir_all(dir.join("DayRail.app")).unwrap();
        assert!(should_remove(&dir, "tauri_updated_app-abc123", future_now()));
    }

    #[test]
    fn generic_prefix_dir_of_another_app_is_never_removed() {
        let scratch = Scratch::new("theirs");
        let dir = scratch.path().join("tauri_updated_app-zzz");
        std::fs::create_dir_all(dir.join("OtherApp.app")).unwrap();
        assert!(!should_remove(&dir, "tauri_updated_app-zzz", future_now()));
        // Empty dir — ownership unknown — also kept.
        let empty = scratch.path().join("tauri_current_app-empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(!should_remove(&empty, "tauri_current_app-empty", future_now()));
    }

    #[test]
    fn fresh_artifacts_survive_the_age_gate() {
        let scratch = Scratch::new("fresh");
        let dir = scratch.path().join("tauri_updated_app-fresh");
        std::fs::create_dir_all(dir.join("DayRail.app")).unwrap();
        // `now` is the real now → the just-created dir is too young.
        assert!(!should_remove(&dir, "tauri_updated_app-fresh", SystemTime::now()));
    }

    #[test]
    fn sweep_removes_only_confirmed_old_artifacts() {
        let scratch = Scratch::new("sweep");
        let root = scratch.path();

        let ours = root.join("tauri_updated_app-ours");
        std::fs::create_dir_all(ours.join("DayRail.app")).unwrap();
        let theirs = root.join("tauri_updated_app-theirs");
        std::fs::create_dir_all(theirs.join("SomeoneElse.app")).unwrap();
        let unrelated = root.join("random-temp-file.txt");
        std::fs::write(&unrelated, b"x").unwrap();
        let win = root.join("DayRail-0.16.4-updater-xyz");
        std::fs::write(&win, b"x").unwrap();

        let removed = sweep_dir(root, future_now());
        assert_eq!(removed, 2);
        assert!(!ours.exists());
        assert!(!win.exists());
        assert!(theirs.exists());
        assert!(unrelated.exists());
    }
}
