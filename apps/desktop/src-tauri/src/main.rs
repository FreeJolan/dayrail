// DayRail desktop · entry binary.
//
// Per ERD §15 / Tauri 2 conventions, the runtime lives in the `lib`
// crate so the same code can be reused if we ever ship mobile entry
// points (currently parked in §15.7). This file is just a thin shim
// that calls into `dayrail_desktop_lib::run`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dayrail_desktop_lib::run();
}
