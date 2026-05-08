// Tauri's codegen step: reads `tauri.conf.json`, produces the
// permission schemas under `gen/schemas/`, embeds icons / metadata
// into the binary at compile time. Don't customize unless you've
// read https://tauri.app/concept/architecture/.
//
// PR-C: also load `.env` (if present, gitignored) and forward the
// keys as `cargo:rustc-env` so `option_env!()` in `drive_auth.rs`
// can read GOOGLE_DESKTOP_CLIENT_ID / GOOGLE_DESKTOP_CLIENT_SECRET
// at compile time. CI sets these via GitHub Secrets and exports them
// as env vars before `cargo build`; local dev reads them from
// `apps/desktop/src-tauri/.env`.

fn main() {
    if let Ok(env_file) = std::fs::read_to_string(".env") {
        for raw_line in env_file.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            // Strip optional surrounding quotes (`KEY="value"` or
            // `KEY='value'`); leave bare values alone.
            let value = value
                .trim()
                .trim_start_matches(['"', '\''])
                .trim_end_matches(['"', '\'']);
            println!("cargo:rustc-env={}={}", key, value);
        }
        // Re-run if .env changes so the embedded values stay in sync.
        println!("cargo:rerun-if-changed=.env");
    }

    // CI sets these as process env (release.yml); local dev sets them
    // via .env (loaded above). Tell cargo to rebuild when either of
    // them changes so a stale `option_env!()` value doesn't get baked
    // into a binary after the secret rotates.
    println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=GOOGLE_DESKTOP_CLIENT_SECRET");

    tauri_build::build();
}
