import { createConfigureExec } from "../../../packages/services/postfix-relay/lib/postfix-relay-configure.mjs";

const exec = createConfigureExec("ssh", { user: "root", host: "10.0.0.160" });

const inner = "set -euo pipefail\nsleep 2\necho SLEEP_OK\napt-get update -qq\necho APT_OK";
const b64 = Buffer.from(inner, "utf8").toString("base64");
const quoted = b64.replace(/'/g, `'\\''`);
const r = exec.run(`echo '${quoted}' | base64 -d | bash`, { capture: true });
console.log("status", r.status);
console.log("stdout", JSON.stringify(r.stdout));
console.log("stderr", JSON.stringify(r.stderr));

const r2 = exec.run(inner, { capture: true });
console.log("direct status", r2.status);
console.log("direct stdout", JSON.stringify(r2.stdout));
