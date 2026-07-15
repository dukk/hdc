# SMTP2GO (hdc)

Sender domains, IP allowlist, and Restrict Senders for your SMTP2GO account are managed with the **smtp2go** infrastructure package (`clumps/infrastructure/smtp2go/`). Outbound SMTP relay credentials for the internal **postfix-relay** service remain separate.

## API key vs SMTP relay credentials

| Purpose | Vault / env | Used by |
| --- | --- | --- |
| SMTP2GO API | `HDC_SMTP2GO_API_KEY` | `hdc run infrastructure smtp2go` |
| SMTP submission to SMTP2GO | `HDC_POSTFIX_RELAY_SMTP_USER`, `HDC_POSTFIX_RELAY_SMTP_PASSWORD` | `clumps/services/postfix-relay` |

Do not confuse the API key with the SMTP username/password on the postfix-relay host.

## API key

1. Open [SMTP2GO](https://www.smtp2go.com/) → **Sending → API Keys**.
2. Create a key with permissions for:
   - **Sender domains:** `/domain/view`, `/domain/add`, `/domain/verify`
   - **IP allowlist:** `/ip_allow_list`, `/ip_allow_list/view`, `/ip_allow_list/add`, `/ip_allow_list/edit`, `/ip_allow_list/remove`
   - **Restrict Senders:** `/allowed_senders/view`, `/allowed_senders/update` (and optionally `/add`, `/remove`)
3. Store it in the hdc vault (never commit):

```bash
hdc secrets set HDC_SMTP2GO_API_KEY
```

You may also set `HDC_SMTP2GO_API_KEY` in repo `.env` (env takes precedence over vault).

## Config

Copy `clumps/infrastructure/smtp2go/config.example.json` to **hdc-private** as `clumps/infrastructure/smtp2go/config.json`, or bootstrap from the live account:

```bash
hdc run infrastructure smtp2go query -- --import --yes
```

Set `managed: true` on resources you want `maintain` to enforce:

- Per-domain `managed` on `sender_domains[]` entries
- Section `managed` on `ip_allow_list` and `allowed_senders`

## Import behavior (sender domains)

`query -- --import --yes` replaces `sender_domains[]`, `ip_allow_list`, and `allowed_senders` from live API data.

**From SMTP2GO API:** domain FQDN, tracking/return-path subdomains, IP allowlist entries, allowed-senders list and mode.

**Not imported (HDC-local metadata on sender domains):** `notes`, `spf`, `dmarc`, `spf_variant`. These are operator-authored reminders for DNS checklists and documentation. On first bootstrap they default to `null`. On re-import they are preserved only when the same FQDN already existed in config.

Published SPF/DMARC/DKIM records live in **cloudflare** or **bind** config — not in smtp2go config. Query builds a runtime `dns_checklist[]` from API verification data plus your optional `spf`/`dmarc` overrides.

## Restrict Senders vs sender domains

SMTP2GO **Restrict Senders** (`allowed_senders.mode` of `whitelist` or `blacklist`) **disables Sender Domains and Single Sender Emails** in the console. If you rely on verified sender domains (`example.invalid`, etc.), keep `allowed_senders.mode` at **`disabled`** unless you intentionally switch to address/domain allowlisting instead.

IP allowlist is independent: when `ip_allow_list.enabled` is true, only listed **public egress IPs** may submit mail or call the API. List the WAN egress IP of your postfix-relay (as seen by SMTP2GO), not RFC1918 LAN addresses.

## Query and import

```bash
# Diff live account vs config (JSON on stdout)
hdc run infrastructure smtp2go query --

# Limit to one sender domain
hdc run infrastructure smtp2go query -- --domain hdc.example.invalid

# Refresh hdc-private config from live API
hdc run infrastructure smtp2go query -- --import --yes
```

Import preserves section-level `managed` flags and sender-domain metadata (`notes`, `spf`, `dmarc`) when FQDNs match. New domains import with `managed: false`.

Query JSON includes `dns_checklist[]` per sender domain (SPF template, DKIM, return-path, tracking CNAMEs). Apply those records manually via **cloudflare** or **bind** packages — smtp2go does not publish DNS.

## Maintain

```bash
hdc run infrastructure smtp2go maintain --
hdc run infrastructure smtp2go maintain -- --dry-run
hdc run infrastructure smtp2go maintain -- --domain-id hdc-example-invalid
hdc run infrastructure smtp2go maintain -- --prune
hdc run infrastructure smtp2go maintain -- --skip-ip-allow-list --skip-allowed-senders
```

For each `managed: true` sender domain, maintain adds the domain when missing and calls verify when DKIM or return-path is not yet verified.

When `ip_allow_list.managed` is true, maintain syncs `enabled`, adds missing IPs, updates descriptions, and with `--prune` removes live IPs not in config.

When `allowed_senders.managed` is true, maintain replaces the live list and mode via `/allowed_senders/update`.

Re-run `query` after updating DNS until sender-domain verification succeeds.

## Postfix relay

Internal guests send mail to `postfix-relay.home.example.invalid` (port 25) without SMTP2GO credentials. The relay host authenticates upstream to `[mail.smtp2go.com]:587`. See [`clumps/services/postfix-relay/README.md`](../../clumps/services/postfix-relay/README.md).
