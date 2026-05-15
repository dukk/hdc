import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = basename(dirname(here));
const verb = basename(here);
console.error(`[hdc] ${target} ${verb}: stub — add real steps (Ansible, SSH, etc.).`);
process.exit(0);
