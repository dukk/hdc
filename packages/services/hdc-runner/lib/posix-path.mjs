/**
 * Normalize a path for Linux guest scripts/units when rendered on Windows.
 *
 * @param {string} p
 * @returns {string}
 */
export function posixPath(p) {
  return String(p).replace(/\\/g, "/");
}
