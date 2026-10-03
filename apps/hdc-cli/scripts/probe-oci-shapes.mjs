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

async function get(path, query) {
  try {
    return { ok: true, json: await client.request({ host, path, query }) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

for (const ad of ads) {
  const name = ad.name;
  const shape = await get("/20160918/shapes", { compartmentId, availabilityDomain: name });
  const items = shape.ok ? (Array.isArray(shape.json) ? shape.json : shape.json.data || []) : [];
  const e2 = items.filter((s) => /E2\.|E3\.|E4\.|E5\.|Micro|A1\.Flex/.test(String(s.name || "")));
  console.log(name, "shape_count=", items.length, "interesting=", e2.map((s) => s.name));
}

const all = await get("/20160918/shapes", { compartmentId });
const allItems = all.ok ? (Array.isArray(all.json) ? all.json : all.json.data || []) : [];
console.log("compartment shapes (no AD) interesting=", allItems.filter(s => /E2\.|Micro|A1\.Flex/.test(String(s.name||""))).map(s => s.name));

// limits
const limitsHost = `limits.${creds.region}.oci.oraclecloud.com`;
async function limitsGet(path, query) {
  try {
    return { ok: true, json: await client.request({ host: limitsHost, path, query }) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
const lim = await limitsGet("/20181025/resourceAvailability", {
  compartmentId,
  serviceName: "compute",
  limitName: "standard-e2-core-count",
  availabilityDomain: ads[0].name,
});
console.log("limit standard-e2-core-count AD1:", lim.ok ? lim.json : lim.error);
const lim2 = await limitsGet("/20181025/resourceAvailability", {
  compartmentId,
  serviceName: "compute",
  limitName: "standard-e2-core-ad-count",
  availabilityDomain: ads[0].name,
});
console.log("limit standard-e2-core-ad-count AD1:", lim2.ok ? lim2.json : lim2.error);
const lim3 = await limitsGet("/20181025/resourceAvailability", {
  compartmentId: creds.tenancyOcid,
  serviceName: "compute",
  limitName: "standard-e2-core-count",
  availabilityDomain: ads[0].name,
});
console.log("tenancy limit standard-e2-core-count AD1:", lim3.ok ? lim3.json : lim3.error);