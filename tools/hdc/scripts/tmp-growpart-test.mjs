import { createConfigureExec } from "../../../packages/services/postfix-relay/lib/postfix-relay-configure.mjs";
import { growRootFilesystemScript } from "../../../packages/lib/qemu-rootfs-resize.mjs";

const exec = createConfigureExec("ssh", { user: "root", host: "10.0.0.160" });
const r = exec.run(growRootFilesystemScript(), { capture: true });
console.log("status", r.status);
console.log("stdout", r.stdout);
console.log("stderr", r.stderr);
