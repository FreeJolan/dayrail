# Domain model

- **Line**: `kind=project`, `habit`, or `group`. Inbox is the protected built-in
  project. Manually-authored tasks belong to active projects. Habits generate
  their own tasks from bindings; do not duplicate them as manual tasks.
- **Task**: a piece of work, with title, note, priority and optional expected
  window. An expected window expresses intent, not an actual scheduled slot.
- **Occurrence**: one independently scheduled/completed step or work session of
  a Task. Add occurrences to decompose an existing task. Do not create duplicate
  sibling Tasks just to represent several sittings. Once occurrences exist,
  schedule/complete those occurrences rather than the parent Task.
- **percent**: the parent task's milestone position reached when the occurrence
  is done (max of completed positions). It is not a share of effort or a duration.
- **Rail**: a time window owned by a day template. `rail resolve --date` returns
  the date-effective Rails for that day's resolved template. `calendar list`
  resolves rules and previews scheduled/virtual habit activity without writing.
- **Template / Rule**: templates describe day shapes; ordered calendar rules
  select the shape for a date. The shared UI fallback prefers workday/restday
  keys, then the default template, then the first template.
- **Binding**: connects an existing habit Line to a Rail, optionally narrowed by
  weekdays (0=Sunday). A daily habit may need a Rail/binding in each day template.
- **Revision**: Rail, template, rule and binding changes are effective-dated.
  Set effectiveFrom explicitly for future changes; do not rewrite history.
- **Signal / Shift**: evidence of check-ins and deferral/moving decisions. Read
  them to understand execution history. Scheduling/status commands maintain
  their domain side effects; editing raw stored fields bypasses those rules.
- **Reflection / Note / Profile**: a day's written reflection, calendar note,
  and the user's background/preferences. Read these when relevant to planning.
- **Trash**: task and line deletion is soft and restorable. The CLI exposes no
  permanent purge. Other removal commands disclose their confirmation behavior
  in the command schema. Do not treat archival as completion.

Adding the first scheduled split to an already-scheduled task preserves its old
schedule through the existing adoption behavior. Inspect returned/listed
occurrences before adding further steps or scheduling to avoid unintended extra
work sessions. The parent task's effective status/progress is derived when it
has splits; use `task get`'s effectiveStatus and the actual occurrence rows.
