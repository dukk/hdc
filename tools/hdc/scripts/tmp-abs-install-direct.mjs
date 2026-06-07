import { createConfigureExec } from "../../../packages/services/postfix-relay/lib/postfix-relay-configure.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../packages/lib/package-run-config.mjs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { resolveAudiobookshelfDeployments, dataDiskGbFromDeployment } from "../../../packages/services/audiobookshelf/lib/deployments.mjs";
import { buildInstallScript } from "../../../packages/services/audiobookshelf/lib/audiobookshelf-install.mjs";
import {
  renderComposeYaml,
  renderAudiobookshelfEnv,
  composeDir,
  dataMount,
} from "../../../packages/services/audiobookshelf/lib/audiobookshelf-render.mjs";
import {
  buildAudiobookshelfDataDiskMountScript,
  AUDIOBOOKSHELF_DOCKER_DATA_ROOT,
} from "../../../packages/services/audiobookshelf/lib/proxmox-data-disk.mjs";

const pkgRoot = join(repoRoot(), "packages/services/audiobookshelf");
const cfg = loadPackageConfigFromPackageRoot(pkgRoot).data;
const [d] = resolveAudiobookshelfDeployments(cfg, { instance: "a" });
const inner = buildInstallScript(
  composeDir(d.install),
  renderComposeYaml(),
  renderAudiobookshelfEnv(d.audiobookshelf, d.install),
  {
    dataDiskMountScript: buildAudiobookshelfDataDiskMountScript(dataMount(d.install)),
    dockerDataRoot: AUDIOBOOKSHELF_DOCKER_DATA_ROOT,
    growRoot: true,
  },
);

const exec = createConfigureExec("ssh", { user: "root", host: "10.0.0.160" });
console.log("script length", inner.length);
const t0 = Date.now();
const r = exec.run(inner, { capture: true });
console.log("elapsed", Date.now() - t0, "status", r.status);
console.log("stdout tail:", r.stdout.slice(-500));
console.log("stderr tail:", r.stderr.slice(-500));
