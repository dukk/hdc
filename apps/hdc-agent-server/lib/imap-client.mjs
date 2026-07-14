/**
 * Minimal IMAP (TLS) client for UNSEEN fetch — no npm deps.
 * Compatible with Dovecot/Mailcow for LOGIN + FETCH RFC822.
 */
import tls from "node:tls";

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} [opts.port]
 * @param {string} opts.user
 * @param {string} opts.password
 * @param {boolean} [opts.rejectUnauthorized]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{ uid: number, raw: string }[]>}
 */
export async function fetchUnseenMessages(opts) {
  const host = String(opts.host ?? "").trim();
  const port = Number(opts.port) > 0 ? Number(opts.port) : 993;
  const user = String(opts.user ?? "").trim();
  const password = String(opts.password ?? "");
  if (!host || !user || !password) {
    throw new Error("imap host, user, and password are required");
  }

  const socket = await connectTls({
    host,
    port,
    rejectUnauthorized: opts.rejectUnauthorized !== false,
    timeoutMs: opts.timeoutMs ?? 60_000,
  });

  try {
    await readUntagged(socket); // greeting
    await command(socket, "A1", `LOGIN ${imapQuote(user)} ${imapQuote(password)}`);
    await command(socket, "A2", "SELECT INBOX");
    const search = await command(socket, "A3", "UID SEARCH UNSEEN");
    const uids = parseSearchUids(search);
    /** @type {{ uid: number, raw: string }[]} */
    const out = [];
    for (const uid of uids) {
      const fetched = await command(socket, `F${uid}`, `UID FETCH ${uid} (RFC822)`);
      const raw = extractRfc822(fetched);
      if (raw) out.push({ uid, raw });
    }
    await command(socket, "A9", "LOGOUT").catch(() => {});
    return out;
  } finally {
    socket.destroy();
  }
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {boolean} opts.rejectUnauthorized
 * @param {number} opts.timeoutMs
 */
function connectTls(opts) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: opts.host,
      port: opts.port,
      rejectUnauthorized: opts.rejectUnauthorized,
      servername: opts.host,
    });
    const t = setTimeout(() => {
      socket.destroy();
      reject(new Error("IMAP TLS connect timeout"));
    }, opts.timeoutMs);
    socket.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    socket.once("secureConnect", () => {
      clearTimeout(t);
      resolve(socket);
    });
  });
}

/** @param {string} s */
function imapQuote(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @param {import("node:tls").TLSSocket} socket
 * @param {string} tag
 * @param {string} line
 */
async function command(socket, tag, line) {
  socket.write(`${tag} ${line}\r\n`);
  return readUntilTag(socket, tag);
}

/**
 * @param {import("node:tls").TLSSocket} socket
 * @param {string} tag
 */
function readUntilTag(socket, tag) {
  return new Promise((resolve, reject) => {
    let buf = "";
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      const re = new RegExp(`(?:^|\\r?\\n)${tag} (OK|NO|BAD)([^\\r\\n]*)`, "m");
      const m = buf.match(re);
      if (!m) return;
      socket.off("data", onData);
      socket.off("error", onErr);
      clearTimeout(t);
      if (m[1] !== "OK") {
        reject(new Error(`IMAP ${tag} ${m[1]}${m[2] || ""}`));
        return;
      }
      resolve(buf);
    };
    /** @param {Error} e */
    const onErr = (e) => {
      clearTimeout(t);
      socket.off("data", onData);
      reject(e);
    };
    const t = setTimeout(() => {
      socket.off("data", onData);
      socket.off("error", onErr);
      reject(new Error(`IMAP timeout waiting for ${tag}`));
    }, 60_000);
    socket.on("data", onData);
    socket.once("error", onErr);
  });
}

/**
 * @param {import("node:tls").TLSSocket} socket
 */
function readUntagged(socket) {
  return new Promise((resolve, reject) => {
    let buf = "";
    /** @param {Buffer} chunk */
    const onData = (chunk) => {
      buf += chunk.toString("utf8");
      if (/\r?\n/.test(buf)) {
        socket.off("data", onData);
        socket.off("error", onErr);
        clearTimeout(t);
        resolve(buf);
      }
    };
    /** @param {Error} e */
    const onErr = (e) => {
      clearTimeout(t);
      socket.off("data", onData);
      reject(e);
    };
    const t = setTimeout(() => {
      socket.off("data", onData);
      socket.off("error", onErr);
      reject(new Error("IMAP greeting timeout"));
    }, 30_000);
    socket.on("data", onData);
    socket.once("error", onErr);
  });
}

/** @param {string} text */
function parseSearchUids(text) {
  const line = text.split(/\r?\n/).find((l) => /^\* SEARCH/i.test(l));
  if (!line) return [];
  return line
    .replace(/^\* SEARCH\s*/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** @param {string} text */
function extractRfc822(text) {
  const m = text.match(/\{(\d+)\}\r?\n/);
  if (!m || m.index == null) return "";
  const len = Number(m[1]);
  const start = m.index + m[0].length;
  return text.slice(start, start + len);
}
