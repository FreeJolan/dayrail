# DayRail — contributor conventions

Instructions for anyone (human or AI) committing to this repo.

## Change flow — always go through a PR

**Rule**: never push directly to `main`. Every change — even a one-line
fix, even from the repo owner — lands via a pull request.

**Why**: the repo enforces "changes must be made through a PR" as a
branch-protection rule on GitHub. The owner's account has bypass
permission, but bypassing erodes the review trail that the rule exists
to preserve (commit context, CI signal, pre-deploy visibility, a
clean `main` history).

**How to apply**:

1. Start work on a short-lived branch off `main`:
   `git checkout -b <scope>/<slug>` — e.g. `cycle/priority-hint`,
   `fix/backlog-boundary`.
2. Commit in that branch following the repo's commit-message style
   (scan `git log` — the current style is
   `<scope> · <one-line description>` with optional body).
3. Push the branch: `git push -u origin <branch>`.
4. Open the PR via `gh pr create` — title + body summarizing the
   change set. Keep the PR title under 70 chars; put details in the
   body.
5. Merge the PR (squash is fine for tight scopes; the owner can use
   the regular "Merge pull request" button for multi-commit branches).
6. Delete the branch after merge.

Direct `git push origin main` is reserved for emergencies (the branch
is stuck / CI is broken and blocking something time-critical). If you
reach for it, note the reason in the next PR's body.
