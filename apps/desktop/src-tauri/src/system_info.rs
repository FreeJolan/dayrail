// System info for the device-label default. PWA falls back to a
// `userAgent`-derived "Chrome on macOS"-style label, which is too
// coarse to distinguish between two Macs on the same Google account.
// On desktop we expose the OS hostname (which the user has typically
// already set to something recognizable like "FreeJolan-MBP") as a
// better default; the user can override via Settings → 同步 → 本设备名.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    /// OS hostname — `gethostname()` on Unix, `GetComputerName` on
    /// Windows. Trimmed of `.local` / `.lan` suffixes that macOS adds
    /// automatically. May be empty on platforms where lookup fails.
    pub hostname: String,
    /// Coarse OS family — "macos" / "windows" / "linux". Mirrors the
    /// `tauri::platform()` values so the frontend can fork display
    /// strings if needed.
    pub os: String,
}

#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    SystemInfo {
        hostname: read_hostname(),
        os: detect_os(),
    }
}

fn read_hostname() -> String {
    // `hostname()` from std isn't stable; shell out instead. The
    // `hostname` binary exists on every desktop platform Tauri
    // targets (macOS / Linux / Windows-via-PowerShell-or-cmd).
    let raw = std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();
    let trimmed = raw.trim();
    // macOS hostname often comes back as "FreeJolan-MBP.local" or
    // "FreeJolan-MBP.lan" — strip the auto-suffix for a cleaner
    // default. Users can keep the suffix by editing the label.
    trimmed
        .trim_end_matches(".local")
        .trim_end_matches(".lan")
        .to_string()
}

fn detect_os() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        std::env::consts::OS.to_string()
    }
}
