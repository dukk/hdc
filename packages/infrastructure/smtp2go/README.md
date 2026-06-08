# SMTP2GO (HDC infrastructure)

Manage **sender domains** on your SMTP2GO account (add, verify, diff vs config). DNS records (SPF, DKIM, return-path, tracking CNAMEs) are reported as checklists for manual Cloudflare or BIND updates — this package does not publish DNS.

SMTP relay credentials for [`postfix-relay`](../../services/postfix-relay/) remain separate (`HDC_POSTFIX_RELAY_SMTP_USER`, `HDC_POSTFIX_RELAY_SMTP_PASSWORD`).

## Secrets

Store the SMTP2GO API key in the hdc vault (never commit):

```bash
node tools/hdc/cli.mjs secrets set HDC_SMTP2GO_API_KEY
```

Create the key in SMTP2GO Console → **Sending → API Keys** (enable domain endpoints). You may also set `HDC_SMTP2GO_API_KEY` in repo `.env` (env takes precedence over vault).

## Config

Copy `config.example.json` to **hdc-private** as `packages/infrastructure/smtp2go/config.json`, or bootstrap from the live account:

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --import --yes
```

Set `managed: true` on domains you want `maintain` to add or verify.

## Query

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go query --
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --domain hdc.dukk.org
node tools/hdc/cli.mjs run infrastructure smtp2go query -- --import --yes
```

## Maintain

```bash
node tools/hdc/cli.mjs run infrastructure smtp2go maintain --
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --dry-run
node tools/hdc/cli.mjs run infrastructure smtp2go maintain -- --domain-id hdc-dukk-org
```

See [`docs/manually-deployed/smtp2go.md`](../../../docs/manually-deployed/smtp2go.md).
