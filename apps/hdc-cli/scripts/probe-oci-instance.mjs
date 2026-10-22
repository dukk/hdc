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
console.log("instance", {
  displayName: inst.displayName,
  lifecycleState: inst.lifecycleState,
  shape: inst.shape,
  availabilityDomain: inst.availabilityDomain,
  timeCreated: inst.timeCreated,
});

const vnics = await client.request({
  host,
  path: `/20160918/vnicAttachments`,
  query: { compartmentId, instanceId },
});
const attachments = Array.isArray(vnics) ? vnics : vnics.data || [];
console.log("vnicAttachments", attachments.map((a) => ({
  lifecycleState: a.lifecycleState,
  vnicId: a.vnicId,
  subnetId: a.subnetId,
})));

for (const a of attachments) {
  if (!a.vnicId) continue;
  const v = await client.request({
    host,
    path: `/20160918/vnics/${encodeURIComponent(a.vnicId)}`,
  });
  console.log("vnic", {
    displayName: v.displayName,
    lifecycleState: v.lifecycleState,
    privateIp: v.privateIp,
    publicIp: v.publicIp,
    isPrimary: v.isPrimary,
    nsgIds: v.nsgIds,
  });
}