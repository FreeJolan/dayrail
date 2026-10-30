# Local agent CLI

## Implementation plan

DayRail exposes domain primitives through a CLI. Skills explain the model and
compose those primitives into planning, decomposition, and review workflows.
There are no model calls or scenario-specific planning commands in the CLI.

The running desktop app owns the live Y.Doc. A dependency-free Node.js client
sends authenticated, newline-delimited JSON over a loopback TCP connection to
Tauri. Rust forwards each request to the main webview. A typed dispatcher calls
existing core actions; their Y.Doc observers update every subscribed UI surface.
Successful mutations wait for local persistence before returning. Drive sync
continues independently through the existing local-edit path.

The bridge is opt-in and device-local. Production and development use different
discovery files. Discovery contains a random token, is private to the OS user,
and is never included in data exports. The client does not read or write .dryj
files and does not launch or focus the app. A closed app returns APP_UNAVAILABLE.

Read primitives cover every business-data collection, including archived and
soft-deleted rows, plus a full business snapshot. Date-resolved calendar and Rail
queries reuse deterministic selectors. Write primitives validate inputs and
references before invoking domain actions. Hard purge and credential access are
not exposed. Task deletion requires a second confirmation inside the app.

Each response carries a runtime-scoped revision. Mutations may supply an expected
revision. Requests are serialized and request IDs are deduplicated within the
running dispatcher; the same ID with different arguments is rejected. Restarting
or reloading the app starts a new runtime. A transport timeout means the outcome
is unknown: inspect state or repeat the same request ID in that runtime rather
than issuing a new create request. Undo sessions remain in memory, matching the
existing UI model; they are not durable transactions or rollback guarantees.

## Verification and release

- Exercise the dispatcher against the real Y.Doc and store actions, with isolated
  in-memory persistence: scheduling, occurrence adoption, UI subscriptions,
  revisions, validation, confirmation, deduplication, and persistence failure.
- Exercise the actual CLI against a fake local bridge: discovery, authentication,
  framing, arguments, response errors, and unavailable-app behavior.
- Check Rust framing/authentication/lifecycle and compile all desktop code.
- Build the desktop bundle. In a headless Tart VM with independent data, enable
  the bridge, create and schedule tasks through the shipped client, inspect the
  visible UI, edit in the UI and read through CLI, then restart and verify data.
- Ship through a PR and tagged GitHub Release using the existing signing pipeline.
  Include the CLI and skill in the app's resources and release assets.


## Usage

Requires Node.js >=18 and a running desktop app. Enable local access in
Settings > Advanced. On macOS, run the following once:

```sh
node /Applications/DayRail.app/Contents/Resources/cli/dayrail.mjs install
# Put ~/.local/bin on PATH if needed.
dayrail --help
dayrail schema task.schedule --json
dayrail task list --status pending --json
dayrail occurrence list --task-id TASK_ID --json
dayrail rail resolve --date 2026-11-03 --json
dayrail task schedule TASK_ID --date 2026-11-03 --rail-id RAIL_ID --json
dayrail data export --json > dayrail-context.json
```

On Linux/Windows, the standalone release client can be run as
`node /path/to/dayrail.mjs`; its `install --dir PATH` command creates a launcher.
The installed launcher's directory must be on PATH. Production discovery is
`app.dayrail.desktop/agent-bridge.json` under the OS app-data directory. Use
`--dev` for the isolated Vite development app. `DAYRAIL_BRIDGE_FILE` selects an
explicit discovery file for tests; no remote host option is exposed.

Use `--input @file.json` for nested patches or long notes. Scalar flags use
kebab-case; JSON keys use camelCase. Every server command's exact JSON schema is
available through `schema`; unknown fields are rejected. `--json` produces a
compact JSON response, otherwise JSON is indented. Errors return a nonzero exit
code and `{ok:false,error:{code,message}}`. Successful responses include
`runtimeId`, `revision`, `requestId`, and `result`.

List results have `items`, `total`, and `nextOffset`; follow every page for a
complete collection. Date filters refer to the entity's date/startDate;
`calendar list` queries scheduled rows and virtual habits by scheduled date.
Task list/get expose derived effectiveStatus without changing stored status.
`data export` includes every business collection and revision/tombstone map,
plus background and holiday/rule-order preferences. It excludes provider
settings, credentials, session state, bridge tokens and diagnostic metadata.

Copy `skills/dayrail` from the app resources or release skill archive into your
agent's skill directory. The skill explains domain semantics and composition;
it grants no independent permission to mutate data.

## Compatibility and limits

No existing data format is changed. There is no direct file-write fallback and
no headless daemon in this version. Closing the app or disabling access prevents
new CLI calls. The CLI never focuses the window. Delete confirmation expires
if left unattended, and changes during confirmation require a new inspection.
Requests exceeding 8 MiB and responses exceeding 64 MiB fail explicitly.

Optional metadata in documented patches can be cleared with null. Task status,
Rail scheduling, and split completion use dedicated commands. Do not use an
arbitrary patch to bypass those transitions. Occurrences only support Rails;
unschedule an existing free-time block before splitting that task.


## Verification record (2026-10-30)

Local checks passed: 385 Vitest cases, five Node CLI transport tests, two Rust
transport tests, workspace type checking, skill validation, and a debug macOS
app bundle built with updater artifacts disabled (release signing remains on
GitHub runners).

An isolated `dayrail-test` Tart VM was started without graphics, clipboard or
audio passthrough. With the real desktop app and bundled CLI, the checks covered
opt-in, launcher installation, creating a template/Rail/task, CLI scheduling
while Today remained open, reading a UI-authored reflection, complete export,
in-app delete confirmation and Trash restoration, unavailable-app reporting,
and reopening the app with the schedule, reflection and background preserved.
The scheduling command in this run took 47ms including client startup; this is
an observation, not a latency guarantee. Screenshots were inspected to verify
that the task appeared on the unchanged Today page and remained after restart.
