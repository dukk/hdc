import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deployTargetInventory, logDeployInventoryStatus } from "../../lib/deploy-inventory.mjs";
import { repoRoot } from "../../../tools/hdc/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
const inv = deployTargetInventory(repoRoot(), target);
logDeployInventoryStatus(target, verb, inv);
process.stderr.write(`[hdc] ${target} ${verb}: stub — add real steps (Ansible, SSH, etc.).\n`);
process.exit(0);
