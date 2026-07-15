# Twilio (hdc)

Account inventory for Elastic SIP trunks and phone numbers is managed with the **twilio** infrastructure package (`clumps/infrastructure/twilio/`). SIP trunk **signaling** credentials for Asterisk remain in the **asterisk** service package.

## API credentials

1. Open the [Twilio Console](https://console.twilio.com/).
2. On the Account dashboard, copy **Account SID** and **Auth Token** (or create a secondary token).
3. Store them in the hdc vault (never commit):

```bash
hdc secrets set HDC_TWILIO_ACCOUNT_SID
hdc secrets set HDC_TWILIO_AUTH_TOKEN
```

You may also set the same variable names in repo `.env` (env takes precedence over vault).

## SIP trunk credentials (Asterisk)

Elastic SIP Trunk **Credential List** username and password are separate secrets used by `clumps/services/asterisk/`:

```bash
hdc secrets set HDC_TWILIO_SIP_USERNAME
hdc secrets set HDC_TWILIO_SIP_PASSWORD
```

The twilio package imports credential **usernames** from the API; Twilio does not return passwords. Set SIP passwords in the vault manually after creating the Credential List in Console.

## Config

Copy `clumps/infrastructure/twilio/config.example.json` to **hdc-private** as `clumps/infrastructure/twilio/config.json`, or bootstrap from the live account:

```bash
hdc run infrastructure twilio query -- --import --yes
```

## Query and import

```bash
# Diff live account vs config (JSON on stdout)
hdc run infrastructure twilio query --

# Limit trunk diff report
hdc run infrastructure twilio query -- --trunk mytrunk

# Refresh hdc-private config from live API
hdc run infrastructure twilio query -- --import --yes
```

Import replaces `sip_trunks[]` and `phone_numbers[]` and updates `twilio.account_sid`, `friendly_name`, and `status`. Vault key references under `twilio.auth` are preserved.

## Asterisk

After import, copy `termination_domain` from the desired `sip_trunks[]` entry into `clumps/services/asterisk/config.json` → `asterisk.twilio.termination_domain`. See [`clumps/services/asterisk/examples/twilio/`](../../clumps/services/asterisk/examples/twilio/).
