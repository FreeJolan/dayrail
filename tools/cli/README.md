# DayRail CLI

Let a local AI agent read and manage your DayRail data through domain primitives.
The CLI talks to the running desktop app, so edits appear in its UI immediately.
It contains no model calls and has no runtime dependencies.

Requires Node.js >=18 and DayRail desktop >=0.16.0. In the app, enable
**Settings > Advanced > Local Agent**. The app must remain running.

## Install

```sh
npm install --global dayrail-cli
dayrail --version
dayrail skills install
dayrail --help
```

Or run without a global install:

```sh
npx dayrail-cli status --json
```

## Use

```sh
dayrail schema task.schedule --json
dayrail task list --status pending --json
dayrail occurrence list --task-id TASK_ID --json
dayrail rail resolve --date 2026-11-03 --json
dayrail task schedule TASK_ID --date 2026-11-03 --rail-id RAIL_ID --json
dayrail data export --json > dayrail-context.json
```

Use `schema` to discover the exact input schemas. Use `--input @file.json` for
nested patches and long notes. Lists expose `nextOffset`; full export includes
all business collections, history, archived rows and Trash, without credentials.
Writes await local saving. The client never accesses .dryj files or focuses the
app. Deletion requires in-app confirmation.

A timeout means the outcome may be unknown. Inspect state or repeat the same
request ID and arguments in the same running runtime. Do not blindly repeat a
create with a new ID. See the [interface guide](https://github.com/FreeJolan/dayrail/blob/main/docs/AGENT-CLI.md)
for revision checks, pagination, deduplication, undo sessions and other limits.

## Agent skill

Install or upgrade the bundled skill with CLI >=0.16.1:

```sh
dayrail skills install                       # Detect configured agents or executables on PATH
dayrail skills install --agent codex,claude   # Choose agents explicitly
dayrail skills install --agent all           # Install for every supported agent
dayrail skills update                        # Upgrade detected agents after updating the CLI
dayrail skills install --dir /path/to/skills  # Install into /path/to/skills/dayrail
```

Both `install` and `update` create missing installations and upgrade existing ones.
They use the skill bundled with the CLI, work offline, and do not require DayRail
to be running. Updating skills does not fetch or upgrade the CLI itself; first run
`npm install --global dayrail-cli@latest` to get a newer bundle.

| Agent | User skill directory |
| --- | --- |
| `codex` | `~/.agents/skills/dayrail` |
| `claude` (alias `claude-code`) | `~/.claude/skills/dayrail` |
| `gemini` (alias `gemini-cli`) | `~/.agents/skills/dayrail` (shared with Codex) |
| `opencode` | `~/.config/opencode/skills/dayrail` |

These follow the documented discovery locations for
[Codex](https://learn.chatgpt.com/docs/build-skills),
[Claude Code](https://code.claude.com/docs/en/skills),
[Gemini CLI](https://geminicli.com/docs/cli/skills/), and
[OpenCode](https://opencode.ai/docs/skills/). Claude's `CLAUDE_CONFIG_DIR` and
OpenCode's `XDG_CONFIG_HOME` are respected. `CODEX_HOME` is used for detection;
Codex skills use the shared `~/.agents/skills` directory. Use `--dir` for other
agents or custom locations. Existing copies in other directories are not moved;
check for a same-named skill in another discovery location if an old copy loads.

Identical installations are left unchanged. A changed installation is backed up
in `.dayrail-skill-backups/` beside the skills directory before replacement. The
JSON response includes each target's status, path, and backup path when present.
Custom files are preserved in the backup. Symlinked skill folders or files are
rejected without replacement; inspect those links or choose another target.
An older CLI refuses to downgrade a copy installed by a newer CLI.
If one target fails, the error details include results for every selected agent.
Start a new agent session or reload skills if the skill does not appear.

The skill explains Tasks, Occurrences, Rails, templates, habits and planning
composition. Its packaged source remains at `$(npm root -g)/dayrail-cli/skill`.
There are no npm install hooks; skill installation requires the explicit command.

## Publishing from source

From `tools/cli`, run `npm pack`, inspect the resulting tarball, then publish the
tested tarball with `npm publish /path/to/dayrail-cli-VERSION.tgz --access public
--registry=https://registry.npmjs.org/`. The prepack script copies the canonical
skill and license; no install hooks execute on users' machines. Release source
changes through the repository's PR flow before publishing.
