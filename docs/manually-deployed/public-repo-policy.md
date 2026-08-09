# Public repo policy (hdc)

The **hdc** repository on GitHub is public automation and documentation. **Live operator data** belongs in the sibling private repo **hdc-private** (or any path set via `HDC_PRIVATE_ROOT`).

## What belongs where

| Artifact | Public hdc | hdc-private |
| --- | --- | --- |
| Package code (`clumps/**`) | Yes | No (mirror paths only for configs) |
| `config.example.json` | Yes | Optional copy |
| `config.json` | **Never** | Yes |
| `operations/inventory/**` | `_example.json` only (all inventory kinds: systems, services, networks, targets, domains, policies, dns) | Live sidecars |
| `operations/automated/**` | `_example.json` only (`systems/`, `networks/`, `policies/`, `domains/`) | Live overlays |
| `operations/tasks/`, `proposals/`, `reports/`, `research/` | `_example*.md` templates only | Live ops state |
| `operations/_example-*.md` | Templates for `ip-allocations`, `delegation-policy`, `task-report` | Live files without `_example-` prefix |
| `.env` | Only `.env.example` | Yes |
| Live DNS zone JSON / site IP tables | **Never** | Yes |
| Deploy/maintain reports under `clumps/**/reports/` | No (gitignored) | Yes |

Resolution order in the CLI: public file first, then hdc-private merge for the same relative path. Top-level ops files use an `_example-` prefix in public hdc so they never shadow live private filenames.

## Fictional fixtures in public examples

Use RFC 5737 documentation addresses and reserved example domains so published trees do not describe a real home LAN:

| Use | Example |
| --- | --- |
| LAN | `192.0.2.0/24` (`192.0.2.1` gateway, `192.0.2.2` DNS, …) |
| Documentation MAC | `00:00:5E:00:53:00` (RFC 7042) |
| DNS zones | `example.invalid`, `hdc.example.invalid`, `home.example.invalid` |
| Operator email in docs/tests | `ops@example.invalid` |
| Extra brand domains in WAF examples | `brand-a.example`, `brand-b.example` |

Do not commit real hostnames, MAC addresses, VMIDs from production, or operator emails in the public repo.

## Never commit

- `config.json` (any package)
- `operations/**` live sidecars (anything that is not an `_example` / `_example-*` template)
- `.env` (except `.env.example`)
- `vault.enc`, `*.pem`, `*.key`, `**/client_secret*.json`
- Operation reports under `clumps/**/reports/`
- One-off live probes (`apps/hdc-cli/scripts/test-*.mjs`)

## If something leaks

1. Rotate any exposed credentials immediately.
2. Remove the file from HEAD and add a CI/gitignore guard if missing.
3. Purge from history with `git filter-repo` on the affected paths, then force-push after team notice.
4. Re-run `gitleaks detect` on the rewritten clone.

## Going public checklist

- [ ] `npm test` green
- [ ] No `10.0.0.x`, real domains, or private keys in tracked files
- [ ] GitHub secret scanning and push protection enabled on `dukk/hdc`
- [ ] **hdc-private** remains private and is not a submodule of hdc
