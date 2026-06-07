import { createConfigureExec } from "../../../packages/services/postfix-relay/lib/postfix-relay-configure.mjs";
import { loadPackageConfigFromPackageRoot } from "../../../packages/lib/package-run-config.mjs";
import { join } from "node:path";
import { repoRoot } from "../paths.mjs";
import { resolveAudiobookshelfDeployments } from "../../../packages/services/audiobookshelf/lib/deployments.mjs";
import { installAudiobookshelfOnHost } from "../../../packages/services/audiobookshelf/lib/audiobookshelf-install.mjs";
import { dataDiskGbFromDeployment } from "../../../packages/services/audiobookshelf/lib/deployments.mjs";

const pkgRoot = join(repoRoot(), "packages/services/audiobookshelf");
const cfg = loadPackageConfigFromPackageRoot(pkgRoot).data;
const [d] = resolveAudiobookshelfDeployments(cfg, { instance: "a" });
const exec = createConfigureExec("ssh", { user: "root", host: "10.0.0.160" });
const r = await installAudiobookshelfOnHost(exec, d.audiobookshelf, d.install, dataDiskGbFromDeployment(d));
console.log(JSON.stringify(r, null, 2));
