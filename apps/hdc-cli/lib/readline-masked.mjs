import { StringDecoder } from "node:string_decoder";
import { createInterface } from "node:readline/promises";
import { stdin as stdinStream, stderr as stderrStream } from "node:process";
import { CliExit } from "./cli-exit.mjs";

/**
 * Read one line from stdin without echoing characters (shows `*` instead).
 * Prompt and mask echoes go to `output` (use stderr when stdout is piped).
 *
 * @param {string} question
 * @param {NodeJS.WriteStream} [output]
 * @param {import("node:stream").Readable & { isTTY?: boolean; setRawMode?: (enable: boolean) => void; isRaw?: boolean }} [input]
 * @returns {Promise<string>} line without trailing newline
 */
export async function readLineMasked(question, output = stderrStream, input = stdinStream) {
  const out = /** @type {NodeJS.WriteStream} */ (output);
  const inStream = /** @type {typeof stdinStream} */ (input);

  if (!inStream.isTTY || typeof inStream.setRawMode !== "function") {
    const rl = createInterface({ input: inStream, output: out });
    try {
      out.write(
        "Warning: terminal is not a TTY; password input cannot be masked and may be visible.\n",
      );
      return await rl.question(question);
    } finally {
      rl.close();
    }
  }

  return new Promise((resolve, reject) => {
    out.write(question);
    const decoder = new StringDecoder("utf8");
    let line = "";
    /** @type {"none" | "esc" | "csi" | "esc_o"} */
    let mode = "none";
    const wasRaw = Boolean(inStream.isRaw);
    inStream.setRawMode(true);
    inStream.resume();

    const finish = () => {
      if (inStream.isTTY && typeof inStream.setRawMode === "function") {
        inStream.setRawMode(wasRaw);
      }
      inStream.removeListener("data", onData);
      inStream.pause();
      try {
        decoder.end();
      } catch {
        /* ignore trailing incomplete UTF-8 */
      }
    };

    const onData = (buf) => {
      const text = decoder.write(buf);
      for (const ch of text) {
        if (mode === "csi") {
          const c = ch.charCodeAt(0);
          if (c >= 0x40 && c <= 0x7e) mode = "none";
          continue;
        }
        if (mode === "esc_o") {
          mode = "none";
          continue;
        }
        if (mode === "esc") {
          if (ch === "[") mode = "csi";
          else if (ch === "O") mode = "esc_o";
          else mode = "none";
          continue;
        }
        if (ch === "\u001b") {
          mode = "esc";
          continue;
        }

        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          finish();
          out.write("\n");
          resolve(line);
          return;
        }
        if (ch === "\u0003") {
          finish();
          out.write("\n");
          reject(new CliExit(130));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (line.length) {
            line = line.slice(0, -1);
            out.write("\b \b");
          }
          continue;
        }
        const cp = ch.codePointAt(0) ?? 0;
        if (cp < 32 && ch !== "\t") continue;

        line += ch;
        out.write("*");
      }
    };

    inStream.on("data", onData);
  });
}
