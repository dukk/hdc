# SMTP2GO (hdc)

Sender domain inventory and verification for your SMTP2GO account is managed with the **smtp2go** infrastructure package (`packages/infrastructure/smtp2go/`). Outbound SMTP relay credentials for the internal **postfix-relay** service remain separate.

## API key vs SMTP relay credentials

| Purpose | Vault / env | Used by |
| --- | --- | --- |
| SMTP2GO API (sender domains) | `HDC_SMTP2GO_API_KEY` | `hdc run infrastructure smtp2go` |
| SMTP submission to SMTP2GO | `HDC_POSTFIX_RELAY_SMTP_USER`, `HDC_POSTFIX_RELAY_SMTP_PASSWORD` | `packages/services/postfix-relay` |

Do not confuse the API key with the SMTP username/password on the postfix-relay host.

## API key

1. Open [SMTP2GO](https://www.smtp2go.com/) → **Sending → API Keys**.
2. Create a key with permissions for **sender domain** endpoints (`/domain/view`, `/domain/add`, `/domain/verify`).
3. Store it in the hdc vault (never commit):

```bash
node tools/hdc/cli.mjs secrets set HDC_SMTP2GO_API_KEY
```

You may also set `HDC_SMTP2GO_API_KEY` in repo `.env` (env takes precedence over vault).

## Config

Copy `packages/infrastructure/smtp2go/config.example.json` to **hdc-private** as `packages/infrastructure/smtp2go/config.json`, or bootstrap from the live account:

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --import --yes
```

Set `managed: true` on `sender_domains[]` entries you want `maintain` to add or verify.

## Query and import

```bash
# Diff live account vs config (JSON on stdout)
node tools/hdc/cli.mjs run infrastructure smtp2go query --

# Limit to one domain
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --domain hdc.dukk.org

# Refresh hdc-private config from live API
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --import --yes
```

Import replaces `sender_domains[]` from live data. Existing entries keep their `managed` flag; new domains import with `managed: false`.

Query JSON includes `dns_checklist[]` per domain (SPF, DKIM, return-path, tracking CNAMEs). Apply those records manually via **cloudflare** or **bind** packages — smtp2go does not publish DNS.

## Maintain

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go maintain --
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --domain-id hdc-dukk-org
```

For each `managed: true` domain, maintain adds the domain when missing and calls verify when DKIM or return-path is not yet verified. Re-run `query` after updating DNS until verification succeeds.

## Postfix relay

Internal guests send mail to `postfix-relay.hdc.dukk.org` (port 25) without SMTP2GO credentials. The relay host authenticates upstream to `[mail.smtp2go.com]:587`. See [`packages/services/postfix-relay/README.md`](../../packages/services/postfix-relay/README.md).
