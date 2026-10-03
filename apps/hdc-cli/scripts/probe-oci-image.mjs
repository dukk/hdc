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
const imageId =
  "ocid1.image.oc1.iad.aaaaaaaaxuoxbmbtrnnkm6n5zcjyu4ac6ocmdcxpdxr6s7ndrcfhroc5maiq";
const client = createOciClient({
  credentials: creds,
  region: creds.region,
  compartmentId,
});
const host = iaasHost(creds.region);

async function get(path, query) {
  try {
    const json = await client.request({ host, path, query });
    return { ok: true, json };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const ads = await client.listAvailabilityDomains();
console.log(
  "ADs:",
  JSON.stringify(
    ads.map((a) => a.name),
    null,
    2,
  ),
);
const resolved = await client.resolveAvailabilityDomain("AD-1");
console.log("resolved AD-1 ->", resolved);

const img = await get("/20160918/images/" + encodeURIComponent(imageId));
if (img.ok) {
  console.log(
    "GET image:",
    JSON.stringify(
      {
        id: img.json.id,
        displayName: img.json.displayName,
        operatingSystem: img.json.operatingSystem,
        operatingSystemVersion: img.json.operatingSystemVersion,
        lifecycleState: img.json.lifecycleState,
      },
      null,
      2,
    ),
  );
  const shapes = await get(
    "/20160918/images/" + encodeURIComponent(imageId) + "/shapes",
    { compartmentId },
  );
  const shapeItems = shapes.ok
    ? Array.isArray(shapes.json)
      ? shapes.json
      : shapes.json.data || []
    : [];
  console.log(
    "image shapes:",
    shapes.ok
      ? JSON.stringify(shapeItems.slice(0, 30), null, 2)
      : shapes.error,
  );
} else {
  console.log("GET image FAILED:", img.error);
}

const listed = await get("/20160918/images", {
  compartmentId: creds.tenancyOcid,
  operatingSystem: "Canonical Ubuntu",
  operatingSystemVersion: "22.04",
  shape: "VM.Standard.E2.1",
  limit: "8",
});
if (listed.ok) {
  const items = Array.isArray(listed.json)
    ? listed.json
    : listed.json.data || [];
  console.log(
    "Ubuntu 22.04 E2.1 images:",
    items.map((i) => ({
      id: i.id,
      name: i.displayName,
      state: i.lifecycleState,
    })),
  );
} else {
  console.log("list images failed:", listed.error);
}

const shape = await get("/20160918/shapes", {
  compartmentId,
  availabilityDomain: resolved,
});
if (shape.ok) {
  const items = Array.isArray(shape.json) ? shape.json : shape.json.data || [];
  const e2 = items.filter((s) =>
    String(s.name || s.shape || "").includes("E2.1"),
  );
  console.log(
    "E2.1 shapes in AD:",
    e2.map((s) => s.name || s),
  );
} else {
  console.log("shapes list failed:", shape.error);
}