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

The package includes the DayRail skill and its references in `skill/`. After a
global install, that folder is at `$(npm root -g)/dayrail-cli/skill`.
Copy its contents into your agent's `dayrail` skill directory, such as
`~/.codex/skills/dayrail` or `~/.claude/skills/dayrail`.

The skill explains Tasks, Occurrences, Rails, templates, habits and planning
composition. Installing the CLI does not modify your agent configuration.

## Publishing from source

From `tools/cli`, run `npm pack`, inspect the resulting tarball, then publish the
tested tarball with `npm publish /path/to/dayrail-cli-VERSION.tgz --access public
--registry=https://registry.npmjs.org/`. The prepack script copies the canonical
skill and license; no install hooks execute on users' machines. Release source
changes through the repository's PR flow before publishing.
