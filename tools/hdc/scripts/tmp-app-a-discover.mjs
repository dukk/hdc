import { qemuGuestExec } from "../../../packages/lib/pve-pct-remote.mjs";

const pveHost = "10.0.0.15";
const vmid = 111;

const cmds = [
  "docker ps --filter name=audiobookshelf --format '{{.Names}} {{.Image}} {{.Status}}'",
  "docker inspect audiobookshelf_audiobookshelf_1 --format '{{json .Mounts}}' 2>/dev/null || docker ps -a --format '{{.Names}}'",
  "du -sh /var/audiobookshelf/* 2>/dev/null || echo no_var_abs",
  "ls -la /var/audiobookshelf/ 2>/dev/null",
];

for (const cmd of cmds) {
  console.log("\n===", cmd.slice(0, 60), "===");
  const r = qemuGuestExec("root", pveHost, vmid, cmd, { capture: true });
  console.log("status", r.status);
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.log("stderr:", r.stderr);
}
