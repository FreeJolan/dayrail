// Local snapshot backups under `app_data_dir()/backups/`.
//
// Triggered automatically before high-risk operations (pre-update,
// pre-import, pre-force-push) so the user has a known-good local
// recovery point even if the operation goes sideways. Manual recovery
// + listing happens through Settings → 同步 → 本地数据 → 自动备份.
//
// Why under app_data_dir, not Downloads:
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
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const BACKUPS_SUBDIR: &str = "backups";
/// How many auto-backups to keep. Beyond this, the oldest is GC'd
/// when a new one is created. Files are typically a few hundred KB
/// each so 10 ≈ 5 MB total — negligible footprint.
const MAX_BACKUPS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    /// Just the filename, not the full path. Frontend uses this as
    /// the key when calling backup_read / backup_delete /
    /// backup_export_to.
    pub filename: String,
    /// "pre-update" / "pre-import" / "pre-force-push" / "manual"
    pub reason: String,
    pub size_bytes: u64,
    /// ISO 8601 string, parseable by `new Date()` on the JS side.
    pub created_at: String,
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {}", e))?;
    Ok(dir.join(BACKUPS_SUBDIR))
}

fn ensure_backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = backups_dir(app)?;
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
    format!("dayrail-{}-{}.dryj", now, reason_part)
}

#[tauri::command]
pub async fn backup_save(
    app: AppHandle,
    reason: String,
    bytes: Vec<u8>,
) -> Result<BackupEntry, String> {
    if bytes.is_empty() {
        return Err("refusing to write an empty backup".to_string());
    }
    let dir = ensure_backups_dir(&app)?;
    let filename = make_filename(&reason);
    let path = dir.join(&filename);
    fs::write(&path, &bytes).map_err(|e| format!("write backup: {}", e))?;

    let entry = BackupEntry {
        filename: filename.clone(),
        reason,
        size_bytes: bytes.len() as u64,
        created_at: Utc::now().to_rfc3339(),
    };

    // GC old backups beyond MAX_BACKUPS. Best-effort — failure to GC
    // shouldn't fail the save.
    let _ = gc_old_backups(&dir);

    Ok(entry)
}

fn gc_old_backups(dir: &PathBuf) -> std::io::Result<()> {
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with(".dryj")
        })
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.path(), m.modified().ok()?))
        })
        .collect();
    if entries.len() <= MAX_BACKUPS {
        return Ok(());
    }
    // Sort newest first, drop the head, delete the rest.
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in entries.into_iter().skip(MAX_BACKUPS) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub async fn backup_list(app: AppHandle) -> Result<Vec<BackupEntry>, String> {
    let dir = backups_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<BackupEntry> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| format!("read backups dir: {}", e))?;
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let filename = entry.file_name().to_string_lossy().to_string();
        if !filename.ends_with(".dryj") {
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
        .strip_prefix("dayrail-")
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
pub async fn backup_read(app: AppHandle, filename: String) -> Result<Vec<u8>, String> {
    let path = resolve_safe_path(&app, &filename)?;
    fs::read(&path).map_err(|e| format!("read backup: {}", e))
}

#[tauri::command]
pub async fn backup_delete(app: AppHandle, filename: String) -> Result<(), String> {
    let path = resolve_safe_path(&app, &filename)?;
    fs::remove_file(&path).map_err(|e| format!("delete backup: {}", e))
}

#[tauri::command]
pub async fn backup_export_to(
    app: AppHandle,
    filename: String,
    dest_path: String,
) -> Result<(), String> {
    let src = resolve_safe_path(&app, &filename)?;
    fs::copy(&src, &dest_path).map_err(|e| format!("copy backup: {}", e))?;
    Ok(())
}

/// Defence-in-depth: refuse to act on a filename containing path
/// separators or `..`. Without this, a compromised webview could
/// pass `../../<anything>` and read/delete arbitrary files via the
/// backup commands. Filenames must look like `dayrail-...dryj`
/// strictly inside the backups dir.
fn resolve_safe_path(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || !filename.ends_with(".dryj")
    {
        return Err(format!("invalid backup filename: {}", filename));
    }
    let dir = backups_dir(app)?;
    Ok(dir.join(filename))
}
