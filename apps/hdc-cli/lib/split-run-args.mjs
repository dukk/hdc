/**
 * Split argv at `--` for `run` forwarding.
 * @param {string[]} argv
 * @returns {{ forward: string[], extra: string[] }}
 */
export function splitRunArgs(argv) {
  const idx = argv.indexOf("--");
  if (idx === -1) return { forward: argv, extra: [] };
  return { forward: argv.slice(0, idx), extra: argv.slice(idx + 1) };
}
