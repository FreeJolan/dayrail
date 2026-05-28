# DayRail - Agent Conventions

Instructions for Codex and other AI agents working in this repository.

## Change Flow

Never push directly to `main`. Every change, including one-line fixes,
lands through a pull request.

Use this flow:

1. Start from latest `main` on a short-lived branch.
2. Commit with the existing style: `<scope> · <one-line description>`.
3. Push the branch and open a PR.
4. Wait for checks, then merge the PR.
5. Delete the branch after merge.

Direct `git push origin main` is reserved for emergencies only.

## Language

- Source code, code comments, debug logs, and commit messages are English.
- UI copy follows the product surface language. Chinese UI strings are fine.
- ERD/product docs are bilingual. Update both `docs/ERD.zh-CN.md` and
  `docs/ERD.en.md` when changing ERD-level behavior.

## Data Compatibility

DayRail is in small-scale internal beta. Preserve user data.

- Data-layer changes must be backward-compatible.
- Add migrations for schema changes.
- Do not silently reinterpret stored data in a lossy way.
- UX and interaction changes can move faster as long as data remains safe.

## Product Judgment

Keep DayRail focused on the actual planning workflow it serves.

- Prefer existing repo patterns and mature libraries over bespoke solutions.
- Before adding a new mode, branch, or option, ask what happens if it is not added.
- Keep main UI copy human and non-technical. Put raw error details behind details
  panels or diagnostic surfaces.
- Match the UI form to the interaction lifetime: persistent surfaces for ongoing
  reference, transient surfaces for review-and-clear flows.
- Do not expose internal AI schemas or implementation models in user-facing UI.

## Backlog And Planning UX

The Backlog drawer is a persistent planning surface. Keep it efficient for repeated
planning actions:

- Backlog task deletion must require an in-app second confirmation.
- Deletion is soft delete and should remain restorable through Trash.
- Split backlog rows should open the parent task detail and focus the occurrence
  that was clicked.

## Local Agent Config

Do not commit local agent credentials, MCP secrets, OAuth tokens, or per-user API
keys. Use `.codex/config.example.toml` as a template and keep the real
`.codex/config.toml` local.
