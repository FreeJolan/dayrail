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
    clean_hostname(&raw_hostname())
}

/// Windows: the release binary is a GUI-subsystem process
/// (`windows_subsystem = "windows"` in main.rs), so spawning the
/// console program `hostname.exe` allocates a brand-new console — a
/// black conhost window flashes on screen at every launch. Read the
/// `COMPUTERNAME` environment variable instead: the OS sets it for
/// every process to the same computer name `GetComputerName` returns,
/// no child process involved.
#[cfg(windows)]
fn raw_hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

/// Unix: `hostname()` from std isn't stable; shell out instead. The
/// `hostname` binary exists on every Unix desktop platform Tauri
/// targets (macOS / Linux), and spawning a child never opens a window
/// outside Windows.
#[cfg(not(windows))]
fn raw_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default()
}

/// macOS hostname often comes back as "FreeJolan-MBP.local" or
/// "FreeJolan-MBP.lan" — strip the auto-suffix for a cleaner
/// default. Users can keep the suffix by editing the label.
fn clean_hostname(raw: &str) -> String {
    raw.trim()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostname_cleanup_strips_whitespace_and_auto_suffixes() {
        assert_eq!(clean_hostname("FreeJolan-MBP.local\n"), "FreeJolan-MBP");
        assert_eq!(clean_hostname("FreeJolan-MBP.lan"), "FreeJolan-MBP");
        assert_eq!(clean_hostname("  DESKTOP-ABC123  "), "DESKTOP-ABC123");
        assert_eq!(clean_hostname(""), "");
    }

    #[test]
    fn hostname_lookup_never_panics() {
        // On any platform this must return without spawning a visible
        // window and without panicking; emptiness is an allowed result.
        let _ = read_hostname();
    }
}
