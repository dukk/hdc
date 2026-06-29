# Wazuh (HDC)

Single-node Wazuh manager on `vm-wazuh-a` (`192.0.2.202`). Linux Proxmox guests enroll via guest baseline; edge nginx-waf nodes ship ModSecurity and access logs.

## Vault secrets

| Key | Purpose |
| --- | --- |
| `HDC_WAZUH_API_PASSWORD` | Wazuh indexer/dashboard API (`admin` user) |
| `HDC_WAZUH_AGENT_PASSWORD` | Agent registration password |

Store with:

```bash
node tools/hdc/cli.mjs secrets set HDC_WAZUH_API_PASSWORD
node tools/hdc/cli.mjs secrets set HDC_WAZUH_AGENT_PASSWORD
```

Push to Vaultwarden for scheduled jobs (`secrets push --force`) when using `HDC_SECRET_BACKEND=auto`. Keep `HDC_VAULT_PASSPHRASE` or Vaultwarden master password available to `maintain daily` and `hdc-runner`.

## Deploy and maintain

```bash
node tools/hdc/cli.mjs run service wazuh deploy -- --instance a
node tools/hdc/cli.mjs run service wazuh maintain --
node tools/hdc/cli.mjs run service wazuh query -- --live
```

`maintain` syncs Docker Compose, manager email (`wazuh_manager.conf`), OpenSearch notification channel `hdc-wazuh-alerts`, and (by default) an OpenSearch Alerting monitor `hdc-wazuh-high-severity`. Skip with `--skip-wazuh-mail` or `--skip-dashboard-monitors`.

## Agent rollout

Proxmox `provision.guest_agents.wazuh.manager_host` must point at the manager IP. Run **guest `maintain`** on each Linux VM/LXC (not HAOS, Windows, or Synology):

```bash
node tools/hdc/cli.mjs run service bind maintain --
node tools/hdc/cli.mjs run service nginx-waf maintain --
```

Confirm in reports: `wazuh_agent: agent ensured`. Agent package version is pinned to `defaults.wazuh.release` in the wazuh package config.

## Log collection

| Service | Logs (default) |
| --- | --- |
| nginx-waf | access, error, ModSecurity JSON |
| crowdsec | `crowdsec.log`, `crowdsec-api.log` |
| postfix-relay | `mail.log` |

Override per package with `defaults.wazuh.log_collection[]` in that service `config.json`.

## Alerting

Two paths:

1. **Manager email** — SMTP via internal postfix-relay (`192.0.2.60`); `email_to` supports comma-separated recipients.
2. **Dashboard notifications** — channel `hdc-wazuh-alerts` to addresses in `defaults.mail.to[]`.

Tune noise with `defaults.mail.alert_level` and `max_per_hour` in [`packages/services/wazuh/config.json`](../../packages/services/wazuh/config.example.json).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `registration password missing (vault HDC_WAZUH_AGENT_PASSWORD)` | Unlock vault; ensure secret in Vaultwarden or local vault |
| `notifications sync skipped: indexer returned 401` | Re-run `wazuh maintain`; verify `HDC_WAZUH_API_PASSWORD` matches live stack |
| No ModSecurity events | Run full `nginx-waf maintain`; confirm agent active and `wazuh_log_collection: applied` |

Dashboard (LAN): `https://192.0.2.202` or `https://wazuh-a.home.example.invalid`.

## Uptime monitoring

UptimeRobot cannot probe RFC1918 URLs. Use **Gatus** (`gatus` package `endpoints[]`) or nginx-waf external health when exposing the dashboard publicly.

If OpenSearch notifications return 401 after a vault password change, run `wazuh maintain --skip-upgrade` (re-hashes indexer `internal_users.yml` via `securityadmin`). If 401 persists, re-run deploy with `--redeploy-existing` so stack credentials match vault.
