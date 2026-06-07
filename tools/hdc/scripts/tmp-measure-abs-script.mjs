import { loadPackageConfigFromPackageRoot } from "../../../packages/lib/package-run-config.mjs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { resolveAudiobookshelfDeployments } from "../../../packages/services/audiobookshelf/lib/deployments.mjs";
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
const cfg = loadPackageConfigFromPackageRoot(pkgRoot, {
  exampleRel: "packages/services/audiobookshelf/config.example.json",
}).data;
const privateCfg = loadPackageConfigFromPackageRoot(pkgRoot);
const [d] = resolveAudiobookshelfDeployments(privateCfg.data, { instance: "a" });
const inner = buildInstallScript(
  composeDir(d.install),
  renderComposeYaml(),
  renderAudiobookshelfEnv(d.audiobookshelf, d.install),
  {
    dataDiskMountScript: buildAudiobookshelfDataDiskMountScript(dataMount(d.install)),
    dockerDataRoot: AUDIOBOOKSHELF_DOCKER_DATA_ROOT,
  },
);
const b64 = Buffer.from(inner, "utf8").toString("base64");
function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
const oldInner = `echo '${b64.replace(/'/g, `'\\''`)}' | base64 -d | bash`;
const oldCmd = `bash -lc ${shellQuote(oldInner)}`;
const newCmd = `bash -lc ${shellQuote(inner)}`;
console.log(JSON.stringify({ script: inner.length, b64: b64.length, oldCmd: oldCmd.length, newCmd: newCmd.length }, null, 2));
