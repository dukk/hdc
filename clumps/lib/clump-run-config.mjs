export {
  loadClumpConfigFromClumpRoot,
  tryLoadClumpConfigFromClumpRoot,
  tryLoadClumpConfigOrExample,
  clumpRootFromMeta,
  clumpRootFromScriptDir,
} from "../../apps/hdc-cli/lib/clump-config.mjs";

export { readResolvedPackageConfigJson } from "../../apps/hdc-cli/lib/json-config-preprocess.mjs";

export { resolveRepoFile, resolveRepoFilePath } from "../../apps/hdc-cli/lib/private-repo.mjs";

export {
  bootstrapGlobalEnv,
  buildClumpRunEnv,
  loadMergedRepoDotenv,
} from "../../apps/hdc-cli/lib/clump-env.mjs";
