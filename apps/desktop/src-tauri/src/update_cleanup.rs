// ERD §15.13 — sweep orphaned auto-update temp artifacts at launch.
//
// tauri-plugin-updater (2.x; layouts verified against the locked 2.10.1
// source, src/updater.rs) stages updates in `std::env::temp_dir()`:
//
//   - macOS: `tauri_updated_app*` holds the freshly extracted bundle
//     with the archive's top-level `<App>.app` component STRIPPED
//     (extraction collects `entry.path().iter().skip(1)`), so the
//     directory directly contains `Contents/...`. `tauri_current_app*`
//     holds the replaced old bundle, renamed to the fixed name
//     `current_app` — never the product name.
//   - Linux (AppImage): `tauri_current_app*` holds the old AppImage
//     backup under the fixed name `current_app.AppImage`.
//   - Windows: `DayRail-<version>-updater-*` dirs containing
//     `DayRail-<version>-installer.exe/.msi`; created with `keep()`
//     (never RAII-cleaned) because the installer outlives the process.
//
// On macOS/Linux these are RAII-cleaned when the install function
// returns, but an interrupted download or a forced restart orphans
// them — and each can hold a full app bundle (tens of MB), so they
// accumulate. Best-effort; failures are ignored.
//
// Safety guards (the temp dir is shared by the whole user session, so
// prefix-matching alone is NOT enough to claim an entry):
//
//   1. Ownership — the `tauri_updated_app*` / `tauri_current_app*`
//      prefixes are generic tauri-plugin-updater names used by *every*
//      Tauri app on the machine, and the entries inside carry fixed
//      names (`Contents`, `current_app`, `current_app.AppImage`), not
//      the product name. We claim such a directory only on a positive
//      signal:
//        - macOS: `Contents/Info.plist` (freshly extracted bundle) or
//          `current_app/Contents/Info.plist` (swapped-out backup)
//          declares OUR `CFBundleIdentifier`.
//        - Linux: the directory contains a `current_app.AppImage`
//          backup. That name is identical for every Tauri AppImage
//          app, so this identifies "a Tauri AppImage update backup",
//          not specifically ours; the age gate below is what
//          guarantees a live install is never raced. Boundary: another
//          Tauri app's *orphaned* (≥ MIN_ORPHAN_AGE old) AppImage
//          backup may also be reclaimed — an in-flight one never is.
//      Anything unreadable or unrecognized is not ours to delete. The
//      Windows names embed our product name, which already identifies
//      them as ours.
//   2. Age — only entries whose mtime is at least MIN_ORPHAN_AGE old
//      are removed. A concurrently running DayRail instance mid-update
//      (its artifacts are seconds old) is never raced. The cost is that
//      the leftovers of a just-applied update survive until a launch
//      ≥ 1 h later — a few tens of MB for a short while, in exchange
//      for never deleting an in-progress install.

use std::path::Path;
use std::time::{Duration, SystemTime};

/// Fixed temp-dir prefixes the updater uses on macOS / Linux. Generic —
/// shared with every other Tauri app — so they additionally require a
/// positive ownership/layout signal (see module docs).
const UPDATED_APP_PREFIX: &str = "tauri_updated_app";
const CURRENT_APP_PREFIX: &str = "tauri_current_app";

/// How old (mtime) an artifact must be before we consider it orphaned
/// rather than part of an install that's still running.
const MIN_ORPHAN_AGE: Duration = Duration::from_secs(60 * 60);

/// Info.plist files are ~1 KiB; cap the read so a weird huge file can
/// never stall the sweep.
const MAX_PLIST_BYTES: u64 = 64 * 1024;

/// Scan `std::env::temp_dir()` and remove any orphaned updater
/// artifacts that are confirmed ours. `our_identifier` is the app's
/// bundle identifier from the Tauri config (tauri.conf.json
/// `identifier`), matched against `CFBundleIdentifier` on macOS.
/// Safe to call on every launch.
pub fn sweep_stale_update_artifacts(our_identifier: &str) {
    let tmp = std::env::temp_dir();
    let removed = sweep_dir(&tmp, SystemTime::now(), our_identifier);
    if removed > 0 {
        eprintln!(
            "[update-cleanup] removed {removed} stale updater artifact(s) from {}",
            tmp.display()
        );
    }
}

fn sweep_dir(tmp: &Path, now: SystemTime, our_identifier: &str) -> usize {
    let entries = match std::fs::read_dir(tmp) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut removed = 0usize;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if should_remove(&path, &name, now, our_identifier) && remove_path(&path) {
            removed += 1;
        }
    }
    removed
}

/// True only for entries that (a) match an updater naming pattern,
/// (b) are confirmed updater artifacts belonging to DayRail (or, on
/// Linux, a Tauri AppImage backup — see module docs), and (c) are old
/// enough to be orphans rather than a live install.
fn should_remove(path: &Path, name: &str, now: SystemTime, our_identifier: &str) -> bool {
    let matches = if name.starts_with(UPDATED_APP_PREFIX) {
        // macOS extraction dir: the archive's top-level `<App>.app` is
        // stripped, so the bundle's Contents/ sits at the dir root.
        plist_identifier_matches(&path.join("Contents/Info.plist"), our_identifier)
    } else if name.starts_with(CURRENT_APP_PREFIX) {
        is_claimable_current_app_backup(path, our_identifier)
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

/// Ownership probe for a `tauri_current_app*` backup directory.
///
///   - macOS: the swapped-out old bundle is renamed to `current_app`
///     inside it → check `current_app/Contents/Info.plist` for our
///     bundle identifier.
///   - Linux: the old AppImage is backed up as `current_app.AppImage`.
///     The fixed name carries no per-app identity; combined with the
///     MIN_ORPHAN_AGE gate it still never races a live install.
///
/// An empty or unrecognizable directory (e.g. the macOS privileged-swap
/// path, where the backup rename never happened) is kept: ownership
/// unproven, and it costs no meaningful space.
fn is_claimable_current_app_backup(path: &Path, our_identifier: &str) -> bool {
    plist_identifier_matches(
        &path.join("current_app/Contents/Info.plist"),
        our_identifier,
    ) || path.join("current_app.AppImage").is_file()
}

/// True when the plist at `plist_path` exists, is readable XML, and
/// declares `CFBundleIdentifier` equal to `our_identifier`. Anything
/// else (missing file, binary plist, foreign identifier) fails safe.
fn plist_identifier_matches(plist_path: &Path, our_identifier: &str) -> bool {
    use std::io::Read;
    let file = match std::fs::File::open(plist_path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut contents = String::new();
    if file
        .take(MAX_PLIST_BYTES)
        .read_to_string(&mut contents)
        .is_err()
    {
        return false;
    }
    plist_bundle_identifier(&contents) == Some(our_identifier)
}

/// Minimal scan of an XML plist for the `CFBundleIdentifier` value:
/// the first `<string>` element after the exact key. Tauri-bundler
/// writes Info.plist as XML, so this is sufficient without pulling in
/// a plist dependency; a binary plist simply never matches (fail-safe).
fn plist_bundle_identifier(contents: &str) -> Option<&str> {
    let rest = &contents[contents.find("<key>CFBundleIdentifier</key>")?..];
    let start = rest.find("<string>")? + "<string>".len();
    let end = start + rest[start..].find("</string>")?;
    Some(rest[start..end].trim())
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

    /// Matches `identifier` in tauri.conf.json.
    const OUR_ID: &str = "app.dayrail.desktop";
    const OTHER_ID: &str = "com.example.otherapp";

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

    /// Writes a realistic tauri-bundler-style XML Info.plist under
    /// `bundle_root/Contents/`, mirroring what sits inside a real
    /// updater temp dir.
    fn write_bundle_contents(bundle_root: &Path, identifier: &str) {
        let contents = bundle_root.join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleDisplayName</key>
  <string>DayRail</string>
  <key>CFBundleIdentifier</key>
  <string>{identifier}</string>
  <key>CFBundleShortVersionString</key>
  <string>0.16.4</string>
</dict>
</plist>
"#
        );
        std::fs::write(contents.join("Info.plist"), plist).unwrap();
    }

    #[test]
    fn plist_scan_extracts_bundle_identifier() {
        let plist = "<key>CFBundleName</key>\n<string>DayRail</string>\n\
                     <key>CFBundleIdentifier</key>\n\t<string>app.dayrail.desktop</string>";
        assert_eq!(plist_bundle_identifier(plist), Some("app.dayrail.desktop"));
        assert_eq!(plist_bundle_identifier("<dict></dict>"), None);
        // Key present but no value element — no match, no panic.
        assert_eq!(
            plist_bundle_identifier("<key>CFBundleIdentifier</key>"),
            None
        );
    }

    #[test]
    fn windows_updater_names_match_only_our_product() {
        assert!(is_windows_updater_artifact("DayRail-0.16.4-updater-abc"));
        assert!(is_windows_updater_artifact("DayRail-0.16.4-installer.exe"));
        assert!(!is_windows_updater_artifact("OtherApp-1.0-updater-abc"));
        assert!(!is_windows_updater_artifact("DayRail-notes.txt"));
        assert!(!is_windows_updater_artifact("tauri_updated_app-xyz"));
    }

    // macOS `tauri_updated_app*`: extraction strips the top-level
    // `DayRail.app`, so `Contents/` sits directly at the dir root.
    #[test]
    fn updated_app_dir_with_our_identifier_is_removed_when_old() {
        let scratch = Scratch::new("upd-ours");
        let dir = scratch.path().join("tauri_updated_appAbC123");
        write_bundle_contents(&dir, OUR_ID);
        assert!(should_remove(
            &dir,
            "tauri_updated_appAbC123",
            future_now(),
            OUR_ID
        ));
    }

    #[test]
    fn updated_app_dir_of_another_app_is_never_removed() {
        let scratch = Scratch::new("upd-theirs");
        let dir = scratch.path().join("tauri_updated_appZzZ");
        write_bundle_contents(&dir, OTHER_ID);
        assert!(!should_remove(
            &dir,
            "tauri_updated_appZzZ",
            future_now(),
            OUR_ID
        ));
        // No Contents/Info.plist at all — ownership unknown — kept.
        let bare = scratch.path().join("tauri_updated_appBare");
        std::fs::create_dir_all(&bare).unwrap();
        assert!(!should_remove(
            &bare,
            "tauri_updated_appBare",
            future_now(),
            OUR_ID
        ));
    }

    // macOS `tauri_current_app*`: the old bundle is renamed to the
    // fixed name `current_app` (never `DayRail.app`).
    #[test]
    fn current_app_backup_with_our_identifier_is_removed_when_old() {
        let scratch = Scratch::new("cur-ours");
        let dir = scratch.path().join("tauri_current_appQ1w2");
        write_bundle_contents(&dir.join("current_app"), OUR_ID);
        assert!(should_remove(
            &dir,
            "tauri_current_appQ1w2",
            future_now(),
            OUR_ID
        ));
    }

    #[test]
    fn current_app_backup_of_another_app_is_never_removed() {
        let scratch = Scratch::new("cur-theirs");
        let dir = scratch.path().join("tauri_current_appE3r4");
        write_bundle_contents(&dir.join("current_app"), OTHER_ID);
        assert!(!should_remove(
            &dir,
            "tauri_current_appE3r4",
            future_now(),
            OUR_ID
        ));
        // Empty backup dir (macOS privileged-swap path) — kept.
        let empty = scratch.path().join("tauri_current_appEmpty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(!should_remove(
            &empty,
            "tauri_current_appEmpty",
            future_now(),
            OUR_ID
        ));
    }

    // Linux `tauri_current_app*`: the backup is the fixed file name
    // `current_app.AppImage`; claimed via name + age gate.
    #[test]
    fn appimage_backup_is_removed_when_old() {
        let scratch = Scratch::new("appimage");
        let dir = scratch.path().join("tauri_current_appT5y6");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("current_app.AppImage"), b"elf-bytes").unwrap();
        assert!(should_remove(
            &dir,
            "tauri_current_appT5y6",
            future_now(),
            OUR_ID
        ));
        // A directory named like the backup file is not the AppImage
        // layout — kept.
        let odd = scratch.path().join("tauri_current_appOdd");
        std::fs::create_dir_all(odd.join("current_app.AppImage")).unwrap();
        assert!(!should_remove(
            &odd,
            "tauri_current_appOdd",
            future_now(),
            OUR_ID
        ));
    }

    #[test]
    fn fresh_artifacts_survive_the_age_gate() {
        let scratch = Scratch::new("fresh");
        let dir = scratch.path().join("tauri_updated_appFresh");
        write_bundle_contents(&dir, OUR_ID);
        // `now` is the real now → the just-created dir is too young.
        assert!(!should_remove(
            &dir,
            "tauri_updated_appFresh",
            SystemTime::now(),
            OUR_ID
        ));
    }

    #[test]
    fn sweep_removes_only_confirmed_old_artifacts() {
        let scratch = Scratch::new("sweep");
        let root = scratch.path();

        // Ours: freshly extracted macOS bundle (root stripped).
        let ours_updated = root.join("tauri_updated_appOurs");
        write_bundle_contents(&ours_updated, OUR_ID);
        // Ours: macOS backup under the fixed `current_app` name.
        let ours_backup = root.join("tauri_current_appOurs");
        write_bundle_contents(&ours_backup.join("current_app"), OUR_ID);
        // Tauri AppImage backup (fixed name, no per-app identity).
        let appimage = root.join("tauri_current_appImg");
        std::fs::create_dir_all(&appimage).unwrap();
        std::fs::write(appimage.join("current_app.AppImage"), b"x").unwrap();
        // Windows artifact named after our product.
        let win = root.join("DayRail-0.16.4-updater-xyz");
        std::fs::write(&win, b"x").unwrap();

        // Another Tauri app's bundles — never touched.
        let theirs_updated = root.join("tauri_updated_appTheirs");
        write_bundle_contents(&theirs_updated, OTHER_ID);
        let theirs_backup = root.join("tauri_current_appTheirs");
        write_bundle_contents(&theirs_backup.join("current_app"), OTHER_ID);
        // Unrelated temp entry — never touched.
        let unrelated = root.join("random-temp-file.txt");
        std::fs::write(&unrelated, b"x").unwrap();

        let removed = sweep_dir(root, future_now(), OUR_ID);
        assert_eq!(removed, 4);
        assert!(!ours_updated.exists());
        assert!(!ours_backup.exists());
        assert!(!appimage.exists());
        assert!(!win.exists());
        assert!(theirs_updated.exists());
        assert!(theirs_backup.exists());
        assert!(unrelated.exists());
    }
}
