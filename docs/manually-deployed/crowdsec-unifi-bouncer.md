# CrowdSec native bouncer on UniFi OS (optional)

HDC automates UniFi blocking via the **`unifi-network` API** (`crowdsec maintain --sync-bouncers` → address group `crowdsec-block`). For higher capacity and gateway-native enforcement, you can install the community **[crowdsec-unifi-bouncer](https://github.com/wolffcatskyy/crowdsec-unifi-bouncer)** directly on the UDM/UDM Pro.

Use **one** enforcement path at a time:

| Path | When to use |
|------|-------------|
| HDC API sync (`type: unifi` in crowdsec config) | Default; no SSH to gateway; capped decisions (~15k) |
| Native UDM bouncer | Higher ipset capacity; sidecar proxy for large blocklists |

## Prerequisites

- Central LAPI running (`crowdsec-a`, e.g. `http://10.0.0.201:8080`)
- SSH access to UniFi OS on the gateway
- Bouncer API key from LAPI

## 1. Mint a bouncer API key on LAPI

On the CrowdSec CT (or via `pct exec`):

```bash
cscli bouncers add unifi-udm-native -o raw
```

Save the key securely. It is rotated if you re-run `cscli bouncers add` with the same name.

## 2. Install on the UDM

SSH to the gateway (default `root@10.0.0.1` on many sites) and run the community bootstrap:

```bash
curl -sSL https://raw.githubusercontent.com/wolffcatskyy/crowdsec-unifi-bouncer/main/bootstrap.sh | bash
```

Edit `/data/crowdsec-bouncer/crowdsec-firewall-bouncer.yaml`:

```yaml
api_url: http://10.0.0.201:8080/
api_key: <key from step 1>
```

If using the **sidecar proxy** (recommended when LAPI has tens of thousands of CAPI decisions):

- Point `api_url` at `http://127.0.0.1:8084/` (sidecar listens locally)
- Set `MAX_DECISIONS` per device limits (see upstream README):
  - UDM Pro / SE: `40000`–`50000`
  - UDR: `15000`

## 3. Disable HDC API UniFi sync

In hdc-private `clumps/services/crowdsec/config.json`, set the UniFi bouncer entry to disabled:

```json
{
  "type": "unifi",
  "group_name": "crowdsec-block",
  "enabled": false
}
```

Keep firewall bouncers on `vm-nginx-waf-*` enabled.

## 4. Verify

```bash
# On UDM
systemctl status crowdsec-firewall-bouncer

# From operator host
hdc run service crowdsec query -- --live
```

Test WAN blocking from an external IP listed in `cscli decisions list` on LAPI.

## References

- [crowdsec-unifi-bouncer](https://github.com/wolffcatskyy/crowdsec-unifi-bouncer)
- [CrowdSec UniFi collection (log parsers)](https://app.crowdsec.net/hub/author/crowdsecurity/collections/unifi)
- [Decision cap guidance for embedded devices](https://github.com/wolffcatskyy/crowdsec-blocklist-import/issues/21)
