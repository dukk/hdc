#!/usr/bin/env node
import { resolveGuestSshUser } from "../../../lib/guest-ssh-resolve.mjs";
/**
 * Query LMS deployments (config summary + optional live status).
 *
 * Usage: hdc run service lms query -- [--instance a]
 *        hdc run service lms query -- --live
 */
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr as errout } from "node:process";

import { repoRoot } from "../../../../tools/hdc/paths.mjs";
import { parseArgvFlags, flagGet } from "../../../lib/parse-argv-flags.mjs";
import {
  listLmsDeploymentSummaries,
  normalizeLmsConfig,
  resolveLmsDeployments,
} from "../lib/deployments.mjs";
import {
  createLmsExec,
  fetchLmsModelsHttp,
  listLmsModels,
  resolveLmsApiBase,
} from "../lib/lms-models.mjs";
import { tryLoadPackageConfigFromPackageRoot } from "../../../lib/package-run-config.mjs";
import { createConfigureExec } from "../../postfix-relay/lib/postfix-relay-configure.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const PACKAGE_CONFIG_EXAMPLE = "packages/services/lms/config.example.json";

const target = basename(dirname(here));
const verb = basename(here);
const root = repoRoot();

/** @param {unknown} v */
function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

async function main() {
  const loaded = tryLoadPackageConfigFromPackageRoot(packageRoot, {
    exampleRel: PACKAGE_CONFIG_EXAMPLE,
  });
  const rel = loaded?.path
    ? relative(root, loaded.path).replace(/\\/g, "/")
    : PACKAGE_CONFIG_EXAMPLE;
  const cfg = loaded?.ok && isObject(loaded.data) ? loaded.data : null;
  const flags = parseArgvFlags(process.argv.slice(2));
  const live = flagGet(flags, "live") !== undefined;

  errout.write(`[hdc] ${target} ${verb}: config ${rel} ${loaded?.ok ? "loaded" : "not loaded"}.\n`);

  /** @type {unknown[]} */
  let deployments = [];
  /** @type {string | null} */
  let configError = null;
  let schemaVersion = null;

  if (cfg) {
    try {
      const norm = normalizeLmsConfig(cfg);
      schemaVersion = norm.schemaVersion;
      deployments = listLmsDeploymentSummaries(cfg);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
  }

  /** @type {Record<string, unknown>[]} */
  const liveResults = [];

  if (live && cfg && !configError) {
    let selected;
    try {
      selected = resolveLmsDeployments(cfg, flags);
    } catch (e) {
      configError = String(/** @type {Error} */ (e).message || e);
    }
    if (selected) {
      for (const d of selected) {
        const raw = isObject(d.raw) ? d.raw : {};
        const apiBase = resolveLmsApiBase(raw);
        /** @type {Record<string, unknown>} */
        const entry = {
          system_id: d.systemId,
          api_base: apiBase,
        };

        const configure = isObject(d.configure) ? d.configure : {};
        const sshCfg = isObject(configure.ssh) ? configure.ssh : {};
        const sshUser = resolveGuestSshUser(sshCfg.user);
        const px = isObject(d.proxmox) ? d.proxmox : {};
        const q = isObject(px.qemu) ? px.qemu : {};
        const ip = typeof q.ip === "string" ? q.ip.trim() : "";
        const sshHost =
          typeof sshCfg.host === "string" && sshCfg.host.trim()
            ? sshCfg.host.trim()
            : ip.split("/")[0];

        if (sshHost) {
          const rootExec = createConfigureExec("ssh", { user: sshUser, host: sshHost });
          const st = rootExec.run("systemctl is-active lmstudio 2>/dev/null || true", {
            capture: true,
          });
          entry.systemd_active = (st.stdout ?? "").trim();
        }

        try {
          const modelExec = createLmsExec(d);
          const listed = await listLmsModels(modelExec);
          entry.models_on_disk = listed.ok ? listed.models : [];
          if (!listed.ok) entry.models_error = listed.error;
        } catch (e) {
          entry.models_error = String(/** @type {Error} */ (e).message || e);
        }

        if (apiBase) {
          const http = await fetchLmsModelsHttp(apiBase);
          entry.http_models = http.ok ? http.models : [];
          if (!http.ok) entry.http_error = http.error;
        }

        liveResults.push(entry);
      }
    }
  }

  const payload = {
    ok: !configError,
    target,
    verb,
    config_path: rel,
    schema_version: schemaVersion,
    config_error: configError,
    deployments,
    live: live ? liveResults : undefined,
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = configError ? 1 : 0;
}

main().catch((e) => {
  errout.write(`[hdc] ${target} ${verb}: fatal: ${/** @type {Error} */ (e).stack || e}\n`);
  process.stdout.write(
    `${JSON.stringify({ ok: false, target, verb, message: String(/** @type {Error} */ (e).message || e) }, null, 2)}\n`,
  );
  process.exitCode = 1;
});

