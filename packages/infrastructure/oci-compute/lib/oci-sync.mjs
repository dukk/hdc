import {
  createContainerInstance,
  createInternetGateway,
  createNsg,
  createRouteTable,
  createSubnet,
  createVcn,
  deleteOciResource,
  launchInstance,
  seedIdMapsFromLive,
} from "./oci-network.mjs";

/** @typedef {import("./oci-api.mjs").OciClient} OciClient */
/** @typedef {import("./oci-config.mjs").NormalizedOciComputeConfig} NormalizedOciComputeConfig */
/** @typedef {import("./oci-plan.mjs").OciPlanAction} OciPlanAction */

/**
 * @param {object} opts
 * @param {OciClient} opts.client
 * @param {NormalizedOciComputeConfig} opts.config
 * @param {Awaited<ReturnType<import("./oci-collect.mjs").collectOciLiveState>>} opts.live
 * @param {OciPlanAction[]} opts.actions
 * @param {boolean} opts.dryRun
 * @param {(line: string) => void} [opts.log]
 */
export async function applyOciPlan(opts) {
  const { client, config, live, actions, dryRun, log = () => {} } = opts;
  /** @type {Record<string, unknown>[]} */
  const results = [];

  const vcnIdMap = new Map();
  const igwIdMap = new Map();
  const rtIdMap = new Map();
  const subnetIdMap = new Map();
  const nsgIdMap = new Map();

  seedIdMapsFromLive(live, vcnIdMap, igwIdMap, rtIdMap, subnetIdMap, nsgIdMap);

  const availabilityDomain = await client.resolveAvailabilityDomain(config.availability_domain);

  const creates = actions.filter((a) => a.action === "create" || a.action === "update");
  const deletes = actions.filter((a) => a.action === "delete").reverse();
  const ordered = creates.concat(deletes);

  for (const action of ordered) {
    if (action.action === "noop") continue;
    if (dryRun && action.action !== "delete") {
      log(`[dry-run] would ${action.action} ${action.kind} ${action.resource_id}`);
      results.push({
        resource_id: action.resource_id,
        kind: action.kind,
        action: action.action,
        dry_run: true,
      });
      continue;
    }

    try {
      let res = null;
      switch (action.action) {
        case "delete":
          res = await deleteOciResource(client, action);
          break;
        case "create":
          switch (action.kind) {
            case "vcn":
              res = await createVcn(client, config, action, vcnIdMap);
              break;
            case "internet_gateway":
              res = await createInternetGateway(client, config, action, vcnIdMap, igwIdMap);
              break;
            case "route_table":
              res = await createRouteTable(client, config, action, vcnIdMap, igwIdMap, rtIdMap);
              break;
            case "subnet":
              res = await createSubnet(
                client,
                config,
                availabilityDomain,
                action,
                vcnIdMap,
                rtIdMap,
                subnetIdMap,
              );
              break;
            case "nsg":
              res = await createNsg(client, config, action, vcnIdMap, nsgIdMap);
              break;
            case "instance":
              res = await launchInstance(
                client,
                config,
                availabilityDomain,
                action,
                subnetIdMap,
                nsgIdMap,
              );
              break;
            case "container_instance":
              res = await createContainerInstance(
                client,
                config,
                availabilityDomain,
                action,
                subnetIdMap,
                nsgIdMap,
              );
              break;
            default:
              log(`skip unsupported kind ${action.kind}`);
          }
          break;
        default:
          break;
      }
      if (res) {
        log(`${action.action} ${action.kind} ${action.resource_id}: ok`);
        results.push({ ...res, action: action.action });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`${action.action} ${action.kind} ${action.resource_id}: failed — ${msg}`);
      results.push({
        resource_id: action.resource_id,
        kind: action.kind,
        action: action.action,
        ok: false,
        error: msg,
      });
      throw err;
    }
  }

  return results;
}
