/**
 * Aggregate nested deploy/configure/install results into a single ok flag.
 * Null/undefined parts are ignored; any part with `ok === false` fails the whole.
 *
 * @param {...({ ok?: boolean } | null | undefined)} parts
 * @returns {boolean}
 */
export function deployOk(...parts) {
  for (const part of parts) {
    if (part == null) continue;
    if (part.ok === false) return false;
  }
  return true;
}
