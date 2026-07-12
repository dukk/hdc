/**
 * Control-flow exception for intentional CLI termination (replaces process.exit in core).
 */
export class CliExit extends Error {
  /**
   * @param {number} code
   */
  constructor(code) {
    super(`CliExit:${code}`);
    this.name = "CliExit";
    /** @type {number} */
    this.code = code;
  }
}
