import { spawnSync } from "node:child_process";
import { devNull } from "node:os";
import { qemuGuestExec, sshRemote } from "../../../packages/lib/pve-pct-remote.mjs";

const PVE = "10.0.0.15";
const APP_VMID = 111;
const APP_IP = "10.0.0.31";
const NEW_HOST = "10.0.0.160";

/** @param {string} cmd */
function guestShort(cmd) {
  const r = qemuGuestExec("root", PVE, APP_VMID, cmd, { capture: true });
  if (r.status !== 0) {
    throw new Error(`guest exec failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

/** @param {string} cmd @param {number} [timeoutMs] */
function sshNew(cmd, timeoutMs = 0) {
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${devNull}`,
    "-o",
    "ConnectTimeout=15",
    `root@${NEW_HOST}`,
    cmd,
  ];
  const r = spawnSync("ssh", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: timeoutMs > 0 ? timeoutMs : undefined,
    maxBuffer: 50 * 1024 * 1024,
  });
  if ((r.status ?? 1) !== 0) {
    throw new Error(`ssh ${NEW_HOST} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return String(r.stdout ?? "").trim();
}

console.log("[1/7] Ensure rsync on app-a …");
guestShort("command -v rsync >/dev/null || (apt-get update -qq && apt-get install -y -qq rsync openssh-server)");

console.log("[2/7] Migration key on new VM …");
sshNew(
  "install -d -m 700 /root/.ssh && test -f /root/.ssh/hdc-migrate || ssh-keygen -N '' -f /root/.ssh/hdc-migrate",
);
const pub = sshNew("cat /root/.ssh/hdc-migrate.pub");
const pubB64 = Buffer.from(pub, "utf8").toString("base64");

console.log("[3/7] Authorize new VM key on app-a …");
guestShort(
  `install -d -m 700 /root/.ssh && PUB=$(echo '${pubB64}' | base64 -d) && grep -qF "$PUB" /root/.ssh/authorized_keys 2>/dev/null || echo "$PUB" >> /root/.ssh/authorized_keys`,
);

console.log("[4/7] Stop ABS on new VM …");
sshNew("cd /opt/audiobookshelf && docker compose stop 2>/dev/null || true");

const rsyncBase =
  "rsync -aHAX --numeric-ids -e 'ssh -i /root/.ssh/hdc-migrate -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'";

console.log("[5/7] Bulk pull from app-a (libraries while ABS still running) …");
for (const dir of ["audiobooks", "ebooks", "podcasts", "metadata"]) {
  console.log(`  pulling ${dir} …`);
  const t0 = Date.now();
  sshNew(`${rsyncBase} root@${APP_IP}:/var/audiobookshelf/${dir}/ /data/audiobookshelf/${dir}/`, 4 * 60 * 60 * 1000);
  console.log(`  ${dir} done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

console.log("[6/7] Stop ABS on app-a; final sync including config …");
guestShort("docker stop audiobookshelf_audiobookshelf_1");
const tFinal = Date.now();
sshNew(`${rsyncBase} --delete root@${APP_IP}:/var/audiobookshelf/ /data/audiobookshelf/`, 4 * 60 * 60 * 1000);
console.log(`  final sync done in ${Math.round((Date.now() - tFinal) / 1000)}s`);

console.log("[7/7] Start ABS on new VM …");
sshNew("cd /opt/audiobookshelf && docker compose up -d && docker compose ps");
const health = sshNew("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:13378/");
console.log("HTTP health:", health);
console.log("Migration complete.");
