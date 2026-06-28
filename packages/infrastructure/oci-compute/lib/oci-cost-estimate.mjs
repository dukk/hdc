import {
  fallbackBootVolumeMonthlyUsd,
  fallbackContainerMonthlyUsd,
  fallbackFlexAdjustUsd,
  fallbackVmMonthlyUsd,
} from "./oci-fallback-prices.mjs";

/** @typedef {import("../../lib/aws-cost-estimate.mjs").CostEstimate} CostEstimate */
/** @typedef {import("./oci-plan.mjs").OciPlanAction} OciPlanAction */

/**
 * @param {OciPlanAction[]} actions
 */
export function estimatePlanCost(actions) {
  /** @type {CostEstimate["lines"]} */
  const lines = [];
  /** @type {string[]} */
  const warnings = [];

  for (const action of actions) {
    if (action.action !== "create") continue;
    const desired = action.desired ?? {};

    if (action.kind === "instance") {
      const shape = String(desired.shape ?? "VM.Standard.E2.1.Micro");
      let monthly = fallbackVmMonthlyUsd(shape);
      if (monthly === null) {
        warnings.push(`Unknown VM shape ${shape}; estimate omitted`);
        continue;
      }
      if (shape.includes("Flex")) {
        monthly += fallbackFlexAdjustUsd(Number(desired.ocpus) || 1, Number(desired.memory_gb) || 1);
      }
      monthly += fallbackBootVolumeMonthlyUsd(Number(desired.boot_volume_gb) || 50);
      lines.push({
        resource_id: action.resource_id,
        description: `OCI VM ${shape}`,
        monthly_usd: monthly,
      });
    }

    if (action.kind === "container_instance") {
      const shape = String(desired.shape ?? "CI.Standard.E4.Flex");
      let monthly = fallbackContainerMonthlyUsd(shape);
      if (monthly === null) {
        warnings.push(`Unknown container shape ${shape}; estimate omitted`);
        continue;
      }
      monthly += fallbackFlexAdjustUsd(Number(desired.ocpus) || 1, Number(desired.memory_gb) || 2);
      lines.push({
        resource_id: action.resource_id,
        description: `OCI Container Instance ${shape}`,
        monthly_usd: monthly,
      });
    }

    if (action.kind === "vcn" || action.kind === "subnet" || action.kind === "nsg") {
      lines.push({
        resource_id: action.resource_id,
        description: `OCI ${action.kind} (no charge)`,
        monthly_usd: 0,
      });
    }
  }

  const total = lines.reduce((sum, line) => sum + (line.monthly_usd ?? 0), 0);
  return {
    lines,
    total_monthly_usd: Math.round(total * 100) / 100,
    unknown: lines.length === 0 && actions.some((a) => a.action === "create"),
    warnings,
  };
}

/**
 * @param {import("./oci-config.mjs").NormalizedOciInstance} instance
 */
export function estimateInstanceCost(instance) {
  const shape = instance.shape;
  let monthly = fallbackVmMonthlyUsd(shape) ?? 0;
  if (shape.includes("Flex")) {
    monthly += fallbackFlexAdjustUsd(instance.ocpus, instance.memory_gb);
  }
  monthly += fallbackBootVolumeMonthlyUsd(instance.boot_volume_gb);
  return {
    lines: [{ resource_id: instance.id, description: `OCI VM ${shape}`, monthly_usd: monthly }],
    total_monthly_usd: Math.round(monthly * 100) / 100,
    unknown: fallbackVmMonthlyUsd(shape) === null,
    warnings: [],
  };
}

/**
 * @param {import("./oci-config.mjs").NormalizedContainerInstance} ci
 */
export function estimateContainerInstanceCost(ci) {
  const shape = ci.shape;
  let monthly = fallbackContainerMonthlyUsd(shape) ?? 0;
  monthly += fallbackFlexAdjustUsd(ci.ocpus, ci.memory_gb);
  return {
    lines: [
      { resource_id: ci.id, description: `OCI Container Instance ${shape}`, monthly_usd: monthly },
    ],
    total_monthly_usd: Math.round(monthly * 100) / 100,
    unknown: fallbackContainerMonthlyUsd(shape) === null,
    warnings: [],
  };
}
