# CLI usage

```sh
dayrail status --json
dayrail schema task.update --json
dayrail task list --status pending --limit 100 --offset 0 --json
dayrail occurrence list --task-id TASK_ID --json
dayrail rail resolve --date 2026-11-03 --json
dayrail calendar list --from 2026-11-02 --to 2026-11-08 --json
dayrail reflection list --from 2026-10-01 --to 2026-10-30 --json
dayrail profile get --json
dayrail data export --json > /tmp/dayrail-context.json
```

List `from`/`to` filter an entity's own date/startDate, not task slot dates.
Use `calendar list` to query scheduled items by date. The full export has no
pagination. Do not mistake a page for the complete database.

```sh
dayrail task create --title 'Prepare launch' --request-id UNIQUE_ID --json
dayrail occurrence add --task-id TASK_ID --label 'Outline' --request-id UNIQUE_ID --json
dayrail occurrence schedule OCC_ID --date 2026-11-03 --rail-id RAIL_ID --json
dayrail task update TASK_ID --input '{"patch":{"priority":"P1","note":"Draft scope"}}' --json
dayrail reflection set --date 2026-11-03 --input @reflection.json --json
```

Each UNIQUE_ID above must be different. `--input @file` avoids shell escaping
for long notes or nested values. Simple scalar flags use kebab-case; JSON input
uses camelCase. Optional clearable metadata fields accept null inside `patch`.
Inspect the command's schema for exactly which fields can be cleared.

For a weekly planning request, compose reads of projects/tasks, existing agenda,
Rail availability, relevant notes and history. Discuss assumptions about effort
and priorities. If edits are authorized, create missing splits and schedule them
with explicit dates and returned IDs; query the agenda again to check the result.
This is an example, not a required fixed planning sequence.

For multi-command undo, open a session and pass the returned sessionId to those
commands whose schemas accept it. Close the session afterward. `session undo`
only undoes tracked operations in this running app; operations without sessionId
support are not part of that group. Never describe a session as all-or-nothing.
