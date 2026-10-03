#!/usr/bin/env node
import { loadMergedRepoDotenv } from "../lib/clump-env.mjs";
import { repoRoot } from "../paths.mjs";
import { resolveOciComputeCredentials } from "hdc/clump/infrastructure/oci-compute/lib/vault-deps.mjs";
import { createOciClient, iaasHost } from "hdc/clump/infrastructure/oci-compute/lib/oci-api.mjs";

const root = repoRoot();
loadMergedRepoDotenv(root, ".env", process.env);
loadMergedRepoDotenv(root, "clumps/infrastructure/oci-compute/.env", process.env);
const creds = await resolveOciComputeCredentials();
const compartmentId =
  "ocid1.compartment.oc1..aaaaaaaaygs7okydbdpxsdclrhqwylw7tdptit47h2q3obu3oi3g4mrr5wla";
const client = createOciClient({ credentials: creds, region: creds.region, compartmentId });
const host = iaasHost(creds.region);

const wr = await client.request({
  host,
  path: "/20160918/workRequests",
  query: { compartmentId },
});
const items = Array.isArray(wr) ? wr : wr.data || [];
console.log("count", items.length);
for (const w of items.slice(0, 5)) {
  console.log("WR", JSON.stringify({
    id: w.id,
    operationType: w.operationType,
    status: w.status,
    timeAccepted: w.timeAccepted,
    timeStarted: w.timeStarted,
    timeFinished: w.timeFinished,
    percentComplete: w.percentComplete,
    compartmentId: w.compartmentId,
  }, null, 2));
  if (!w.id) continue;
  try {
    const errors = await client.request({
      host,
      path: `/20160918/workRequests/${encodeURIComponent(w.id)}/errors`,
    });
    console.log("errors", JSON.stringify(errors, null, 2).slice(0, 3000));
  } catch (e) {
    console.log("errors fetch failed", e.message);
  }
  try {
    const logs = await client.request({
      host,
      path: `/20160918/workRequests/${encodeURIComponent(w.id)}/logs`,
    });
    const logItems = Array.isArray(logs) ? logs : logs.data || [];
    console.log("logs", logItems.slice(0, 10));
  } catch (e) {
    console.log("logs fetch failed", e.message);
  }
}