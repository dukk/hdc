# Cursor hooks (hdc)

## `auto-commit-on-stop.mjs`

On agent **`stop`** with `status: completed`, if **hdc** and/or sibling **hdc-private** (or `HDC_PRIVATE_ROOT`) have safe dirty paths, emits a `followup_message` so the agent:

1. Reviews `git status` / `git diff` per dirty repo
2. Writes a [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) message (`type(optional-scope): description`)
3. Commits (separate commit per dirty repo)

The hook does **not** run `git commit` itself and never pushes.

- Skips secret paths (`.env`, `.env.*`, `*.enc`, `vault.enc`) — listed in the follow-up as do-not-stage
- `loop_limit: 2` in `hooks.json` — at most two auto follow-ups; `loop_count >= 2` yields `{}`
- Fail-open: unexpected errors print `{}` so the agent session is not blocked

### Escape hatches

| Variable | Effect |
| --- | --- |
| `HDC_SKIP_AUTO_COMMIT=1` | Skip follow-up (no auto-commit request) |
| `HDC_PRIVATE_ROOT` | Override hdc-private path; if set but missing, private is skipped (no sibling fallback) |

Note: Cursor has no Keep-click hook — this runs when the agent finishes, usually before Keep/Undo. Undo after a commit may require `git reset`.
