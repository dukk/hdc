import { stderr as errout } from "node:process";

import { sshRemote } from "./pve-pct-remote.mjs";

/**
 * Ubuntu cloud templates often use serial0 + vga=serial0, which can stall first boot
 * when no serial console is attached. Prefer std VGA and drop serial0, then refresh cloud-init.
 *
 * @param {object} opts
 * @param {string} opts.user PVE SSH user
 * @param {string} opts.host PVE SSH host
 * @param {number} opts.vmid
 * @param {boolean} [opts.verifyIso9660] Also require cloud-init volume to be ISO9660
 * @param {(line: string) => void} [opts.log]
 * @returns {{ ok: boolean; message: string; stdout?: string; stderr?: string }}
 */
export function repairUbuntuQemuConsole(opts) {
  const { user, host, vmid } = opts;
  const log = opts.log ?? ((line) => errout.write(`${line}\n`));
  const verifyIso = opts.verifyIso9660 === true;
  const parts = [
    `qm set ${vmid} -vga std -delete serial0 -cpu host || true`,
    `qm cloudinit update ${vmid}`,
  ];
  if (verifyIso) {
    parts.push(
      `CI=$(pvesm path $(qm config ${vmid} | awk -F'[: ]+' '/^ide2:/{print $2":"$3; exit}' | sed 's/,.*//') 2>/dev/null)`,
      `test -n "$CI" || CI=$(ls /dev/*/vm-${vmid}-cloudinit /dev/mapper/*vm--${vmid}--cloudinit 2>/dev/null | head -1)`,
      `isoinfo -d -i "$CI" 2>&1 | head -3`,
      `isoinfo -d -i "$CI" 2>&1 | grep -q 'ISO 9660' || { echo "cloud-init drive is not ISO9660 (path=$CI)"; exit 1; }`,
    );
  }
  const cmd = parts.join("; ");
  log(
    `Repairing Ubuntu QEMU console on vmid ${vmid} (vga=std, cpu=host, drop serial0, cloudinit update${verifyIso ? ", verify ISO9660" : ""}) …`,
  );
  const r = sshRemote(user, host, cmd, { capture: true });
  const ok = r.status === 0;
  return {
    ok,
    message: ok ? "console repaired" : `console repair failed (exit ${r.status})`,
    stdout: r.stdout,
    stderr: r.stderr,
  };
}

/**
 * Delete and recreate the cloud-init drive, optionally re-apply ipconfig0 / ciuser / nameserver,
 * then run qm cloudinit update.
 *
 * @param {object} opts
 * @param {string} opts.user
 * @param {string} opts.host
 * @param {number} opts.vmid
 * @param {string} [opts.cloudinitStorage] Storage for cloudinit volume (default local-lvm)
 * @param {string} [opts.ideSlot] Drive slot (default ide2)
 * @param {string} [opts.ipconfig0] e.g. ip=10.0.0.25/24,gw=10.0.0.1
 * @param {string} [opts.ciuser]
 * @param {string} [opts.nameserver]
 * @param {string} [opts.searchdomain]
 * @param {boolean} [opts.ciupgrade] Default false when any network fields set
 * @param {(line: string) => void} [opts.log]
 * @returns {{ ok: boolean; message: string; steps: { cmd: string; status: number; stdout?: string; stderr?: string }[] }}
 */
export function regenQemuCloudInitDrive(opts) {
  const { user, host, vmid } = opts;
  const log = opts.log ?? ((line) => errout.write(`${line}\n`));
  const storage = (opts.cloudinitStorage || "local-lvm").trim() || "local-lvm";
  const ide = (opts.ideSlot || "ide2").trim() || "ide2";
  /** @type {{ cmd: string; status: number; stdout?: string; stderr?: string }[]} */
  const steps = [];

  /**
   * @param {string} cmd
   */
  function run(cmd) {
    log(`$ ${cmd}`);
    const r = sshRemote(user, host, cmd, { capture: true });
    steps.push({
      cmd,
      status: r.status ?? 1,
      stdout: r.stdout,
      stderr: r.stderr,
    });
    return r;
  }

  run(`qm set ${vmid} -delete ${ide} || true`);
  run(`qm set ${vmid} -${ide} ${storage}:cloudinit`);

  const netParts = [];
  if (opts.ipconfig0) netParts.push(`-ipconfig0 ${opts.ipconfig0}`);
  if (opts.ciuser) netParts.push(`-ciuser ${opts.ciuser}`);
  if (opts.nameserver) netParts.push(`-nameserver ${opts.nameserver}`);
  if (opts.searchdomain) netParts.push(`-searchdomain ${opts.searchdomain}`);
  if (netParts.length || opts.ciupgrade !== undefined) {
    const upgrade =
      opts.ciupgrade === true ? "1" : opts.ciupgrade === false || netParts.length ? "0" : null;
    const extra = upgrade !== null ? `-ciupgrade ${upgrade}` : "";
    run(`qm set ${vmid} ${netParts.join(" ")} ${extra}`.replace(/\s+/g, " ").trim());
  }

  const update = run(`qm cloudinit update ${vmid}`);
  const ok = steps.every((s) => s.status === 0) || update.status === 0;
  return {
    ok: steps.slice(0, 2).every((s) => s.status === 0) && update.status === 0,
    message: ok ? "cloud-init drive regenerated" : "cloud-init regen had failures",
    steps,
  };
}
