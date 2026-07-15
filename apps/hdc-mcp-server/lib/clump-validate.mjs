/**
 * Static clump package consistency checks for hdc-qa / engineers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  discoverManifests,
  manifestByTierAndId,
  manifestId,
  verbSpec,
  VERBS,
} from "../../hdc-cli/manifests.mjs";
import { normalizeTier } from "./policy.mjs";

/**
 * @param {string} dir
 * @param {string[]} [acc]
 */
function listMjsFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listMjsFiles(p, acc);
    else if (name.endsWith(".mjs")) acc.push(p);
  }
  return acc;
}

/**
 * @param {string} hdcRoot
 * @param {string} clumpId
 */
function conventionalSchemaPath(hdcRoot, clumpId) {
  return join(hdcRoot, "apps", "hdc-cli", "schema", `${clumpId}.config.schema.json`);
}

/**
 * Validate a clump package tree.
 * @param {object} opts
 * @param {string} opts.clumpsRoot absolute path to clumps tree (services/infrastructure/clients)
 * @param {string} opts.hdcRoot public hdc repo root (for schema lookup)
 * @param {string} opts.tier client|infrastructure|service
 * @param {string} opts.clump package id
 */
export function validateClump(opts) {
  const tier = normalizeTier(opts.tier);
  const clumpId = String(opts.clump ?? "").trim();
  if (!clumpId) throw new Error("clump is required");

  /** @type {{ severity: "error"|"warning", code: string, message: string }[]} */
  const findings = [];
  const clumpsRoot = String(opts.clumpsRoot ?? "").trim();
  const hdcRoot = String(opts.hdcRoot ?? "").trim();

  if (!clumpsRoot || !existsSync(clumpsRoot)) {
    return {
      ok: false,
      tier,
      clump: clumpId,
      package_dir: null,
      findings: [
        {
          severity: "error",
          code: "clumps_root_missing",
          message: `clumps root not found: ${clumpsRoot || "(empty)"}`,
        },
      ],
      summary: { errors: 1, warnings: 0 },
    };
  }

  const manifests = discoverManifests(clumpsRoot);
  const m = manifestByTierAndId(manifests, tier, clumpId);
  if (!m) {
    const any = manifests.find((x) => manifestId(x) === clumpId);
    findings.push({
      severity: "error",
      code: "manifest_not_found",
      message: any
        ? `clump ${clumpId} found but not under tier ${tier}`
        : `no manifest for clump ${JSON.stringify(clumpId)} under ${tier}`,
    });
    return {
      ok: false,
      tier,
      clump: clumpId,
      package_dir: any?.dir ?? null,
      findings,
      summary: { errors: findings.filter((f) => f.severity === "error").length, warnings: 0 },
    };
  }

  const id = manifestId(m);
  if (id !== clumpId) {
    findings.push({
      severity: "error",
      code: "manifest_id_mismatch",
      message: `manifest id ${JSON.stringify(id)} does not match requested clump ${JSON.stringify(clumpId)}`,
    });
  }

  const dirName = m.dir.replace(/\\/g, "/").split("/").pop();
  if (dirName && dirName !== id) {
    findings.push({
      severity: "warning",
      code: "dir_id_mismatch",
      message: `package directory name ${JSON.stringify(dirName)} differs from manifest id ${JSON.stringify(id)}`,
    });
  }

  const verbs = m.raw.verbs;
  if (!verbs || typeof verbs !== "object" || Array.isArray(verbs)) {
    findings.push({
      severity: "error",
      code: "verbs_missing",
      message: "manifest.verbs is missing or not an object",
    });
  } else {
    for (const verb of VERBS) {
      const spec = verbSpec(m, verb);
      if (!spec) continue;
      const scriptPath = join(m.dir, spec.script);
      if (!existsSync(scriptPath)) {
        findings.push({
          severity: "error",
          code: "verb_script_missing",
          message: `verb ${verb} script missing: ${spec.script}`,
        });
      }
    }
    if (!verbSpec(m, "query") && !verbSpec(m, "deploy") && !verbSpec(m, "maintain")) {
      findings.push({
        severity: "warning",
        code: "no_core_verbs",
        message: "manifest has no query/deploy/maintain verbs",
      });
    }
  }

  const exampleConfig = join(m.dir, "config.example.json");
  if (!existsSync(exampleConfig)) {
    findings.push({
      severity: "warning",
      code: "config_example_missing",
      message: "config.example.json is missing",
    });
  }

  if (hdcRoot) {
    const schemaPath = conventionalSchemaPath(hdcRoot, id);
    if (!existsSync(schemaPath)) {
      findings.push({
        severity: "warning",
        code: "schema_missing",
        message: `conventional schema not found: apps/hdc-cli/schema/${id}.config.schema.json`,
      });
    }
  }

  const mjsFiles = listMjsFiles(m.dir);
  for (const file of mjsFiles) {
    let src = "";
    try {
      src = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const rel = relative(m.dir, file).replace(/\\/g, "/");
    const isQueryOrDeploy =
      /\/(query|deploy)\/.*\.mjs$/.test(`/${rel}`) || /^(query|deploy)\/.*\.mjs$/.test(rel);
    if (isQueryOrDeploy && /\bconsole\.log\s*\(/.test(src)) {
      findings.push({
        severity: "warning",
        code: "console_log_in_verb",
        message: `${rel}: uses console.log — prefer stderr progress / stdout JSON (see hdc-automation-logging)`,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  return {
    ok: errors === 0,
    tier,
    clump: id,
    package_dir: m.dir,
    findings,
    summary: { errors, warnings },
  };
}
