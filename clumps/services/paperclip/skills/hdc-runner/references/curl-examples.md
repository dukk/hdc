# curl examples (hdc-runner)

Replace `$RUNNER` and `$TOKEN` from company secrets.

```bash
export RUNNER=http://192.0.2.125:9120
export TOKEN=<HDC_RUNNER_API_TOKEN>

# Health
curl -s "$RUNNER/api/health"

# List schedules
curl -s -H "Authorization: Bearer $TOKEN" "$RUNNER/api/schedules"

# Uptime Kuma live query (adhoc)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tier":"service","package":"uptime-kuma","verb":"query","args":["--live"]}' \
  "$RUNNER/api/jobs"

# Trigger monitor schedule
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "$RUNNER/api/schedules/monitor-uptime-kuma/run"

# Poll job (repeat until status not running)
curl -s -H "Authorization: Bearer $TOKEN" "$RUNNER/api/jobs/JOB_ID_HERE"

# Proxmox cluster query via schedule
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  "$RUNNER/api/schedules/monitor-cluster/run"

# Read system inventory
curl -s -H "Authorization: Bearer $TOKEN" "$RUNNER/api/inventory/systems/paperclip-a"
```

## Safe maintain example (SRE only, approved issue)

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"tier":"service","package":"nginx-waf","verb":"maintain","args":["--group","public","--no-reboot","--skip-resources","--skip-clamav-scan"]}' \
  "$RUNNER/api/jobs"
```
