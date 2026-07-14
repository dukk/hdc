# Cursor hooks (hdc)

## `auto-commit-on-stop.mjs`

On agent **`stop`** with `status: completed`, commits dirty trees in **hdc** and sibling **hdc-private** (or `HDC_PRIVATE_ROOT`). Never pushes.

- Commit messages are built from changed paths (`Agent: update …`).
- Skips secret paths (`.env`, `.env.*`, `*.enc`, `vault.enc`).
- Fail-open: git errors are logged to stderr; the hook still exits cleanly.

### Escape hatches

| Variable | Effect |
| --- | --- |
| `HDC_SKIP_AUTO_COMMIT=1` | Skip all auto-commits |
| `HDC_PRIVATE_ROOT` | Override hdc-private path; if set but missing, private is skipped (no sibling fallback) |

Note: Cursor has no Keep-click hook — this runs when the agent finishes, usually before Keep/Undo. Undo after a commit may require `git reset`.
