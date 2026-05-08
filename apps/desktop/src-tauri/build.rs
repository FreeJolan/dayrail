// Tauri's codegen step: reads `tauri.conf.json`, produces the
// permission schemas under `gen/schemas/`, embeds icons / metadata
// into the binary at compile time. Don't customize unless you've
// read https://tauri.app/concept/architecture/.

fn main() {
    tauri_build::build();
}
