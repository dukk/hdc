import { devNull } from "node:os";
import { spawnSync } from "node:child_process";
import { qemuGuestExec, sshRemote } from "../../../packages/lib/pve-pct-remote.mjs";

const PVE = "10.0.0.15";
const APP_VMID = 111;
const APP_IP = "10.0.0.31";
const NEW_HOST = "10.0.0.160";
const LOG = "/var/log/hdc-abs-migrate.log";
const PIDFILE = "/var/run/hdc-abs-migrate.pid";

function guestShort(cmd) {
  const r = qemuGuestExec("root", PVE, APP_VMID, cmd, { capture: true });
  if (r.status !== 0) throw new Error(`guest exec: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

function sshNew(cmd) {
  const r = sshRemote("root", NEW_HOST, cmd, { capture: true });
  if (r.status !== 0) throw new Error(`ssh ${NEW_HOST}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

const rsyncSsh =
  "ssh -i /root/.ssh/hdc-migrate -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ServerAliveCountMax=120";

const remoteScript = [
  "#!/bin/bash",
  "set -euo pipefail",
  `exec >> ${LOG} 2>&1`,
  "echo \"=== hdc abs migrate $(date -Is) ===\"",
  "cd /opt/audiobookshelf && docker compose stop 2>/dev/null || true",
  `RSYNC_SSH='${rsyncSsh}'`,
  `for dir in audiobooks ebooks podcasts metadata; do`,
  `  echo \"pull $dir $(date -Is)\"`,
  `  rsync -aHAX --numeric-ids --partial -e "$RSYNC_SSH" root@${APP_IP}:/var/audiobookshelf/$dir/ /data/audiobookshelf/$dir/`,
  "done",
  `echo \"stop app-a ABS $(date -Is)\"`,
  `ssh -i /root/.ssh/hdc-migrate -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@${APP_IP} docker stop audiobookshelf_audiobookshelf_1 || true`,
  `echo \"final sync $(date -Is)\"`,
  `rsync -aHAX --numeric-ids --partial --delete -e "$RSYNC_SSH" root@${APP_IP}:/var/audiobookshelf/ /data/audiobookshelf/`,
  "cd /opt/audiobookshelf && docker compose up -d",
  "curl -s -o /dev/null -w \"health=%{http_code}\\n\" http://127.0.0.1:13378/",
  "echo \"=== migrate done $(date -Is) ===\"",
].join("\n");

const b64 = Buffer.from(remoteScript, "utf8").toString("base64");
sshNew(`echo '${b64.replace(/'/g, `'\\''`)}' | base64 -d > /root/hdc-abs-migrate.sh && chmod +x /root/hdc-abs-migrate.sh`);

const running = sshNew(
  `test -f ${PIDFILE} && kill -0 $(cat ${PIDFILE}) 2>/dev/null && echo running || echo stopped`,
);
if (running === "running") {
  console.log("Migration already running on guest; tail log:");
  console.log(sshNew(`tail -5 ${LOG} 2>/dev/null || true`));
  process.exit(0);
}

sshNew(`rm -f ${PIDFILE}; nohup /root/hdc-abs-migrate.sh </dev/null >>${LOG} 2>&1 & echo $! > ${PIDFILE}`);
console.log("Started background migration on", NEW_HOST);
console.log("Log:", LOG);
console.log("Poll: ssh root@" + NEW_HOST + " tail -f " + LOG);
