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
const ads = await client.listAvailabilityDomains();
const ad = ads[0].name;
const json = await client.request({
  host,
  path: "/20160918/shapes",
  query: { compartmentId, availabilityDomain: ad },
});
console.log(JSON.stringify(json, null, 2).slice(0, 4000));