// Local snapshot backups. Default location: `app_data_dir()/backups/`.
//
// Triggered automatically before high-risk operations (pre-update,
// pre-import, pre-force-push, pre-rollback) so the user has a
// known-good local recovery point even if the operation goes sideways.
// Manual recovery + listing happens through Settings → 同步 → 本地数据
// → 自动备份.
//
// v0.14.0 (ERD §15.12): the backup directory and retention count are
// configurable. The frontend owns the settings (localStorage, mirroring
// upgradePref) and passes them as optional command args:
//   - `dir`: Some(path) → write/list/GC there directly; None / empty →
//     the default `app_data_dir()/backups/`. Existing installs that
//     never set a dir keep the exact old location, so their backup
//     history stays visible (back-compat).
//   - `max_count`: Some(n) → keep newest n; None → DEFAULT_MAX_BACKUPS.
//
// Why under app_data_dir by default, not Downloads:
//   - Downloads is for user-initiated downloads. Auto-dumping
//     `dayrail-<timestamp>-<reason>.dryj` files there clutters their
//     view and they can't tell what these files are for.
//   - app_data_dir is OS-managed per-user storage that's
//     conventionally hidden from casual file browsing. macOS:
//     `~/Library/Application Support/app.dayrail.desktop/backups/`.
//   - Auto-update preserves app_data_dir (independent of webview /
//     code-signing identity), so the backup history survives across
//     versions.
//
// Why a separate Rust-managed file (instead of inside the .dryj /
// inside OPFS):
//   - Independent recovery surface — if OPFS gets corrupted, the
//     backups stay readable.
//   - User can copy the .dryj out to anywhere (cloud drive / USB /
//     etc.) for bring-your-own redundancy.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const BACKUPS_SUBDIR: &str = "backups";
/// Filename prefix every managed backup carries. List + GC match on
/// this so a user-chosen directory that also holds unrelated `.dryj`
/// files never has those listed or garbage-collected.
const BACKUP_PREFIX: &str = "dayrail-";
/// Default retention when the frontend doesn't pass an explicit count.
/// Files are typically a few hundred KB each, so 20 ≈ 10 MB total —
/// negligible footprint.
const DEFAULT_MAX_BACKUPS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    /// Just the filename, not the full path. Frontend uses this as
    /// the key when calling backup_read / backup_delete /
    /// backup_export_to.
    pub filename: String,
    /// "pre-update" / "pre-import" / "pre-force-push" / "pre-rollback"
    /// / "manual"
    pub reason: String,
    pub size_bytes: u64,
    /// ISO 8601 string, parseable by `new Date()` on the JS side.
    pub created_at: String,
}

/// Resolve the directory backups live in. `custom` (when present and
/// non-empty) is used directly; otherwise fall back to the default
/// `app_data_dir()/backups/`.
fn backups_dir(app: &AppHandle, custom: Option<&str>) -> Result<PathBuf, String> {
    if let Some(c) = custom {
        let trimmed = c.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(dir.join(BACKUPS_SUBDIR))
}

fn ensure_backups_dir(app: &AppHandle, custom: Option<&str>) -> Result<PathBuf, String> {
    let dir = backups_dir(app, custom)?;
    fs::create_dir_all(&dir).map_err(|e| format!("create backups dir: {}", e))?;
    Ok(dir)
}

/// Build the filename for a new backup. Format:
///   dayrail-YYYYMMDDTHHMMSSZ-<reason>.dryj
/// The compact ISO timestamp is sortable lexicographically. Reason
/// is sanitised — only alphanumerics + `-` survive — so we can't
/// accidentally write files with weird names through this path.
fn make_filename(reason: &str) -> String {
    let now = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let safe: String = reason
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let trimmed = safe.trim_matches('-');
    let reason_part = if trimmed.is_empty() {
        "manual"
    } else {
        trimmed
    };
    format!("{}{}-{}.dryj", BACKUP_PREFIX, now, reason_part)
}

/// True for files this module manages (`dayrail-*.dryj`). Loose prefix
/// match — used by `backup_list` so historical / hand-copied snapshots
/// stay visible and restorable.
fn is_managed_backup(filename: &str) -> bool {
    filename.starts_with(BACKUP_PREFIX) && filename.ends_with(".dryj")
}

/// Strict matcher for names `make_filename` itself produces:
/// `dayrail-YYYYMMDDTHHMMSSZ-<reason>.dryj` with a digits-only compact
/// timestamp and a sanitised (alphanumeric + `-`) reason. GC filters on
/// THIS — never on the looser `is_managed_backup` — so it can only ever
/// delete files this module created. A user archive in a custom backup
/// directory, e.g. a manual export `dayrail-2026-11-20.dryj` (our own
/// export default name) or `dayrail-old-laptop.dryj`, is listed but
/// never garbage-collected.
fn is_generated_backup_name(filename: &str) -> bool {
    let Some(rest) = filename.strip_prefix(BACKUP_PREFIX) else {
        return false;
    };
    let Some(rest) = rest.strip_suffix(".dryj") else {
        return false;
    };
    // rest = YYYYMMDDTHHMMSSZ-<reason>; timestamp is exactly 16 chars.
    if rest.len() < 18 || !rest.is_char_boundary(16) {
        return false;
    }
    let (ts, after) = rest.split_at(16);
    let ts = ts.as_bytes();
    let ts_ok = ts[..8].iter().all(|b| b.is_ascii_digit())
        && ts[8] == b'T'
        && ts[9..15].iter().all(|b| b.is_ascii_digit())
        && ts[15] == b'Z';
    if !ts_ok {
        return false;
    }
    let Some(reason) = after.strip_prefix('-') else {
        return false;
    };
    !reason.is_empty() && reason.chars().all(|c| c.is_alphanumeric() || c == '-')
}

#[tauri::command]
pub async fn backup_save(
    app: AppHandle,
    reason: String,
    bytes: Vec<u8>,
    dir: Option<String>,
    max_count: Option<usize>,
) -> Result<BackupEntry, String> {
    if bytes.is_empty() {
        return Err("refusing to write an empty backup".to_string());
    }
    let backups = ensure_backups_dir(&app, dir.as_deref())?;
    let filename = make_filename(&reason);
    let path = backups.join(&filename);
    // Atomic write: temp file + fsync + rename. A crash mid-write
    // (pre-update backups run right before restart-heavy windows) must
    // never leave a truncated `.dryj` that would later be listed as a
    // valid recovery point. The `.tmp` suffix keeps the temp file
    // invisible to backup_list / GC (both require the `.dryj` suffix).
    let tmp = backups.join(format!("{}.tmp", filename));
    write_backup_atomically(&path, &tmp, &bytes).map_err(|e| format!("write backup: {}", e))?;

    let entry = BackupEntry {
        filename: filename.clone(),
        reason,
        size_bytes: bytes.len() as u64,
        created_at: Utc::now().to_rfc3339(),
    };

    // GC old backups beyond the retention count. Best-effort — failure
    // to GC shouldn't fail the save.
    let keep = max_count.unwrap_or(DEFAULT_MAX_BACKUPS).max(1);
    let _ = gc_old_backups(&backups, keep);

    Ok(entry)
}

/// Write `bytes` to `final_path` via `tmp_path` + rename so a crash
/// mid-write can never leave a truncated file under the final name.
/// `sync_all` before the rename so the rename can't be reordered ahead
/// of the data hitting disk (the classic rename-atomicity caveat).
fn write_backup_atomically(
    final_path: &Path,
    tmp_path: &Path,
    bytes: &[u8],
) -> std::io::Result<()> {
    let result = (|| {
        let mut f = fs::File::create(tmp_path)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(tmp_path, final_path)
    })();
    if result.is_err() {
        // Best-effort: don't leave a dangling temp file behind.
        let _ = fs::remove_file(tmp_path);
    }
    result
}

fn gc_old_backups(dir: &PathBuf, keep: usize) -> std::io::Result<()> {
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| is_generated_backup_name(&e.file_name().to_string_lossy()))
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.path(), m.modified().ok()?))
        })
        .collect();
    if entries.len() <= keep {
        return Ok(());
    }
    // Sort newest first, keep the head, delete the rest.
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in entries.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub async fn backup_list(
    app: AppHandle,
    dir: Option<String>,
) -> Result<Vec<BackupEntry>, String> {
    let backups = backups_dir(&app, dir.as_deref())?;
    if !backups.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<BackupEntry> = Vec::new();
    let read = fs::read_dir(&backups).map_err(|e| format!("read backups dir: {}", e))?;
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let filename = entry.file_name().to_string_lossy().to_string();
        if !is_managed_backup(&filename) {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let created = metadata
            .modified()
            .ok()
            .and_then(|t| chrono::DateTime::<Utc>::from(t).into())
            .map(|dt: chrono::DateTime<Utc>| dt.to_rfc3339())
            .unwrap_or_else(|| "".to_string());
        // Parse reason from filename: dayrail-<timestamp>-<reason>.dryj
        let reason = parse_reason_from_filename(&filename);
        out.push(BackupEntry {
            filename,
            reason,
            size_bytes: metadata.len(),
            created_at: created,
        });
    }
    // Newest first.
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

fn parse_reason_from_filename(filename: &str) -> String {
    // dayrail-YYYYMMDDTHHMMSSZ-<reason>.dryj
    let stripped = filename
        .strip_prefix(BACKUP_PREFIX)
        .and_then(|s| s.strip_suffix(".dryj"))
        .unwrap_or(filename);
    // The first hyphen-separated chunk is the timestamp, anything
    // after is the reason. Split on the first ascii uppercase 'Z'
    // (timestamp always ends in Z) followed by a hyphen.
    if let Some(idx) = stripped.find("Z-") {
        return stripped[idx + 2..].to_string();
    }
    "unknown".to_string()
}

#[tauri::command]
pub async fn backup_read(
    app: AppHandle,
    filename: String,
    dir: Option<String>,
) -> Result<Vec<u8>, String> {
    let path = resolve_safe_path(&app, &filename, dir.as_deref())?;
    fs::read(&path).map_err(|e| format!("read backup: {}", e))
}

#[tauri::command]
pub async fn backup_delete(
    app: AppHandle,
    filename: String,
    dir: Option<String>,
) -> Result<(), String> {
    let path = resolve_safe_path(&app, &filename, dir.as_deref())?;
    fs::remove_file(&path).map_err(|e| format!("delete backup: {}", e))
}

#[tauri::command]
pub async fn backup_export_to(
    app: AppHandle,
    filename: String,
    dest_path: String,
    dir: Option<String>,
) -> Result<(), String> {
    let src = resolve_safe_path(&app, &filename, dir.as_deref())?;
    fs::copy(&src, &dest_path).map_err(|e| format!("copy backup: {}", e))?;
    Ok(())
}

/// The default backups directory as an absolute path string. Used by
/// the Settings UI to show where "默认" resolves to and to seed the
/// folder-picker's starting location.
#[tauri::command]
pub async fn backup_default_dir(app: AppHandle) -> Result<String, String> {
    let dir = backups_dir(&app, None)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Defence-in-depth: refuse to act on a filename containing path
/// separators or `..`. Without this, a compromised webview could
/// pass `../../<anything>` and read/delete arbitrary files via the
/// backup commands. Filenames must look like `dayrail-...dryj`
/// strictly inside the (default or configured) backups dir.
fn resolve_safe_path(
    app: &AppHandle,
    filename: &str,
    custom: Option<&str>,
) -> Result<PathBuf, String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.ends_with(".dryj")
    {
        return Err(format!("invalid backup filename: {}", filename));
    }
    let dir = backups_dir(app, custom)?;
    Ok(dir.join(filename))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique scratch dir per test under the real temp dir, cleaned up
    /// by the Drop guard.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "dayrail-backup-test-{}-{}",
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

    #[test]
    fn generated_names_match_the_strict_pattern() {
        // Round-trip: whatever make_filename produces must be GC-able.
        for reason in ["pre-update", "pre-import", "manual", "weird reason!", ""] {
            let name = make_filename(reason);
            assert!(
                is_generated_backup_name(&name),
                "make_filename({reason:?}) produced {name:?} which the strict matcher rejects"
            );
            assert!(is_managed_backup(&name));
        }
        assert!(is_generated_backup_name(
            "dayrail-20261120T093011Z-pre-force-push.dryj"
        ));
    }

    #[test]
    fn user_archives_never_match_the_strict_pattern() {
        for name in [
            // Our own manual-export default name (dayrail-<date>.dryj).
            "dayrail-2026-11-20.dryj",
            // Hand-named archives that pass the loose prefix guard.
            "dayrail-old-laptop.dryj",
            "dayrail-backup-final.dryj",
            // Near misses on the timestamp format.
            "dayrail-20261120X093011Z-manual.dryj",
            "dayrail-20261120T093011Z.dryj",
            "dayrail-20261120T093011Zmanual.dryj",
            "dayrail-20261120T093011Z-.dryj",
            "dayrail-20261120T093011Z-pre update.dryj",
            "dayrail-2026112T0093011Z-manual.dryj",
            // Wrong prefix / suffix entirely.
            "mybackup-20261120T093011Z-manual.dryj",
            "dayrail-20261120T093011Z-manual.dryj.tmp",
        ] {
            assert!(
                !is_generated_backup_name(name),
                "{name:?} must not be eligible for GC"
            );
        }
    }

    #[test]
    fn gc_deletes_only_generated_files_and_keeps_newest() {
        let scratch = Scratch::new("gc");
        let dir = scratch.path().to_path_buf();
        // Three generated backups with strictly increasing mtimes.
        let gen_names = [
            "dayrail-20260101T000000Z-pre-update.dryj",
            "dayrail-20260102T000000Z-pre-import.dryj",
            "dayrail-20260103T000000Z-manual.dryj",
        ];
        let base = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        for (i, name) in gen_names.iter().enumerate() {
            let p = dir.join(name);
            let f = fs::File::create(&p).unwrap();
            f.set_modified(base + std::time::Duration::from_secs(i as u64 * 60))
                .unwrap();
        }
        // User archives sharing the loose dayrail-*.dryj pattern, with
        // the OLDEST mtimes of all — the old GC would delete these first.
        for name in ["dayrail-2025-01-01.dryj", "dayrail-old-laptop.dryj"] {
            let p = dir.join(name);
            let f = fs::File::create(&p).unwrap();
            f.set_modified(base - std::time::Duration::from_secs(86_400))
                .unwrap();
        }

        gc_old_backups(&dir, 2).unwrap();

        assert!(!dir.join(gen_names[0]).exists(), "oldest generated GC'd");
        assert!(dir.join(gen_names[1]).exists());
        assert!(dir.join(gen_names[2]).exists());
        assert!(dir.join("dayrail-2025-01-01.dryj").exists());
        assert!(dir.join("dayrail-old-laptop.dryj").exists());
    }

    #[test]
    fn atomic_write_lands_content_and_leaves_no_temp() {
        let scratch = Scratch::new("atomic");
        let final_path = scratch.path().join("dayrail-20260101T000000Z-manual.dryj");
        let tmp_path = scratch.path().join("dayrail-20260101T000000Z-manual.dryj.tmp");
        write_backup_atomically(&final_path, &tmp_path, b"snapshot-bytes").unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"snapshot-bytes");
        assert!(!tmp_path.exists());
        // Overwrite via the same path keeps working (rename over existing).
        write_backup_atomically(&final_path, &tmp_path, b"second").unwrap();
        assert_eq!(fs::read(&final_path).unwrap(), b"second");
    }
}
