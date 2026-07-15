import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const hookDir = dirname(fileURLToPath(import.meta.url));
register("./import-hook.mjs", pathToFileURL(join(hookDir, "import-hook.mjs")));
