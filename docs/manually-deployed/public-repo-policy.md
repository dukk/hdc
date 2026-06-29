# Public repo policy (hdc)

The **hdc** repository on GitHub is public automation and documentation. **Live operator data** belongs in the sibling private repo **hdc-private** (or any path set via `HDC_PRIVATE_ROOT`).

## What belongs where

| Artifact | Public hdc | hdc-private |
| --- | --- | --- |
| Package code (`packages/**`) | Yes | No (mirror paths only for configs) |
| `config.example.json` | Yes | Optional copy |
| `config.json` | **Never** | Yes |
| `inventory/**` | Only `inventory/manual/systems/_example.json` | Yes |
| `.env` | Only `.env.example` | Yes |
| DNS zone JSON, operations notes | No | Yes |
| Deploy/maintain reports | No (gitignored) | Yes |

Resolution order in the CLI: public file first, then hdc-private merge for the same relative path.

## Fictional fixtures in public examples

Use RFC 5737 documentation addresses and reserved example domains so published trees do not describe a real home LAN:

| Use | Example |
| --- | --- |
| LAN | `192.0.2.0/24` (`192.0.2.1` gateway, `192.0.2.2` DNS, …) |
| DNS zones | `example.invalid`, `hdc.example.invalid`, `home.example.invalid` |
| Operator email in docs/tests | `ops@example.invalid` |
| Extra brand domains in WAF examples | `brand-a.example`, `brand-b.example` |

Do not commit real hostnames, MAC addresses, VMIDs from production, or operator emails in the public repo.

## Never commit

- `config.json` (any package)
- `inventory/**` except `_example.json`
- `.env` (except `.env.example`)
- `vault.enc`, `*.pem`, `*.key`, `**/client_secret*.json`
- Operation reports under `packages/**/reports/`
- One-off live probes (`tools/hdc/scripts/test-*.mjs`)

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
