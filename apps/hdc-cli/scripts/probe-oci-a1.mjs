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

for (const ad of ads) {
  const json = await client.request({
    host,
    path: "/20160918/shapes",
    query: { compartmentId, availabilityDomain: ad.name },
  });
  const items = Array.isArray(json) ? json : json.data || [];
  console.log(
    ad.name,
    items.map((s) => `${s.shape} (${s.billingType})`),
  );
}

const listed = await client.request({
  host,
  path: "/20160918/images",
  query: {
    compartmentId: creds.tenancyOcid,
    operatingSystem: "Canonical Ubuntu",
    operatingSystemVersion: "22.04",
    shape: "VM.Standard.A1.Flex",
    limit: "5",
  },
});
const items = Array.isArray(listed) ? listed : listed.data || [];
console.log(
  "Ubuntu 22.04 A1.Flex images:",
  items.map((i) => ({ id: i.id, name: i.displayName, state: i.lifecycleState })),
);

// Check whether configured image supports A1.Flex
const imageId =
  "ocid1.image.oc1.iad.aaaaaaaaxuoxbmbtrnnkm6n5zcjyu4ac6ocmdcxpdxr6s7ndrcfhroc5maiq";
const shapes = await client.request({
  host,
  path: `/20160918/images/${encodeURIComponent(imageId)}/shapes`,
  query: { compartmentId },
});
const shapeItems = Array.isArray(shapes) ? shapes : shapes.data || [];
const a1 = shapeItems.filter((s) => String(s.shape).includes("A1"));
console.log(
  "configured image supports A1?",
  a1.map((s) => s.shape),
);