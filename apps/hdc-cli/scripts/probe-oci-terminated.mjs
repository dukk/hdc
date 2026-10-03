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
const instanceId =
  "ocid1.instance.oc1.iad.anuwcljt24ve2cacfneoomsxgs55vboalo36v3b3hdperxj4v4zlk6kzsksa";
const client = createOciClient({ credentials: creds, region: creds.region, compartmentId });
const host = iaasHost(creds.region);

const inst = await client.request({
  host,
  path: `/20160918/instances/${encodeURIComponent(instanceId)}`,
});
console.log(JSON.stringify({
  lifecycleState: inst.lifecycleState,
  timeCreated: inst.timeCreated,
  region: inst.region,
  shape: inst.shape,
  imageId: inst.imageId,
  sourceDetails: inst.sourceDetails,
  faultDomain: inst.faultDomain,
  metadataKeys: inst.metadata ? Object.keys(inst.metadata) : [],
}, null, 2));

const list = await client.request({
  host,
  path: "/20160918/instances",
  query: { compartmentId, lifecycleState: "TERMINATED" },
});
const items = Array.isArray(list) ? list : list.data || [];
console.log("terminated instances", items.map((i) => ({
  name: i.displayName,
  state: i.lifecycleState,
  shape: i.shape,
  ad: i.availabilityDomain,
  created: i.timeCreated,
  id: i.id,
})));

async function tryGet(path, query) {
  try {
    return { ok: true, json: await client.request({ host, path, query }) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const wr = await tryGet("/20160918/workRequests", { compartmentId });
console.log("workRequests", wr.ok ? (Array.isArray(wr.json)?wr.json:wr.json.data||[]).slice(0,8).map(w => ({
  operation: w.operationType,
  status: w.status,
  timeStarted: w.timeStarted,
  timeFinished: w.timeFinished,
  percent: w.percentComplete,
  resources: (w.resources||[]).map(r => r.identifier || r.entityType),
})) : wr.error);