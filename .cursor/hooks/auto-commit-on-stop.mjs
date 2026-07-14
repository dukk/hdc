#!/usr/bin/env node
/**
 * Cursor `stop` hook: when the agent finishes successfully, commit dirty trees
 * in hdc and hdc-private with a heuristic message. Never pushes.
 *
 * Escape hatch: HDC_SKIP_AUTO_COMMIT=1
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HDC_ROOT = path.resolve(__dirname, "..", "..");

/** Path basenames that must never be auto-committed. */
const SECRET_BASENAME_RE = /^(?:\.env|\.env\..+|vault\.enc|.*\.enc)$/i;

function respondEmpty() {
  process.stdout.write("{}\n");
}

function log(...args) {
  console.error("[hdc auto-commit]", ...args);
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function git(cwd, args, opts = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
  return result;
}

function isGitWorkTree(cwd) {
  const r = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.status === 0 && String(r.stdout).trim() === "true";
}

function resolvePrivateRoot() {
  const fromEnv = process.env.HDC_PRIVATE_ROOT?.trim();
  if (fromEnv) {
    const resolved = path.resolve(fromEnv);
    if (fs.existsSync(resolved)) return resolved;
  }
  const sibling = path.resolve(HDC_ROOT, "..", "hdc-private");
  if (fs.existsSync(sibling)) return sibling;
  return null;
}

function parsePorcelainPath(line) {
  // XY PATH or XY ORIG -> PATH (rename)
  if (!line || line.length < 4) return null;
  const body = line.slice(3);
  const arrow = body.indexOf(" -> ");
  const filePath = arrow >= 0 ? body.slice(arrow + 4) : body;
  // Unquoted paths; strip optional quotes from git -z-less porcelain
  return filePath.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
}

function isSecretPath(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  if (SECRET_BASENAME_RE.test(base)) return true;
  // Any .env file nested (e.g. clumps/foo/.env)
  if (/(^|\/)\.env($|\.)/i.test(normalized)) return true;
  if (/(^|\/)vault\.enc$/i.test(normalized)) return true;
  return false;
}

function listSafeChangedPaths(cwd) {
  const r = git(cwd, ["status", "--porcelain", "-u"]);
  if (r.status !== 0) {
    log(`git status failed in ${cwd}:`, (r.stderr || r.stdout || "").trim());
    return null;
  }
  const lines = String(r.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean);

  const safe = [];
  const skippedSecrets = [];
  for (const line of lines) {
    const p = parsePorcelainPath(line);
    if (!p) continue;
    if (isSecretPath(p)) {
      skippedSecrets.push(p);
      continue;
    }
    safe.push(p);
  }
  if (skippedSecrets.length) {
    log(`skipping secret paths in ${path.basename(cwd)}:`, skippedSecrets.join(", "));
  }
  return safe;
}

function summarizeAreas(paths) {
  const areas = new Map();
  for (const p of paths) {
    const parts = p.replace(/\\/g, "/").split("/");
    let key;
    if (parts[0] === "clumps" && parts.length >= 3) {
      key = `clumps/${parts[1]}/${parts[2]}`;
    } else if (parts[0] === "apps" && parts.length >= 2) {
      key = `apps/${parts[1]}`;
    } else if (parts[0] === "inventory" && parts.length >= 2) {
      key = `inventory/${parts[1]}`;
    } else if (parts[0] === ".cursor" && parts.length >= 2) {
      key = `.cursor/${parts[1]}`;
    } else {
      key = parts[0] || p;
    }
    areas.set(key, (areas.get(key) || 0) + 1);
  }
  return [...areas.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
}

function buildCommitMessage(cwd, paths) {
  const areas = summarizeAreas(paths);
  const top = areas.slice(0, 3);
  let subject;
  if (top.length === 0) {
    subject = "Agent: update workspace files";
  } else if (top.length === 1) {
    subject = `Agent: update ${top[0]}`;
  } else if (top.length === 2) {
    subject = `Agent: update ${top[0]} and ${top[1]}`;
  } else {
    subject = `Agent: update ${top[0]}, ${top[1]}, and ${top[2]}`;
  }

  const shown = paths.slice(0, 12);
  const bullets = shown.map((p) => `- ${p.replace(/\\/g, "/")}`);
  if (paths.length > shown.length) {
    bullets.push(`- ...and ${paths.length - shown.length} more`);
  }

  const stat = git(cwd, ["diff", "--cached", "--stat"], { maxBuffer: 2 * 1024 * 1024 });
  const statLine =
    stat.status === 0
      ? String(stat.stdout || "")
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .at(-1)
      : "";

  const body = [bullets.join("\n")];
  if (statLine) body.push("", statLine);

  return `${subject}\n\n${body.join("\n")}\n`;
}

function commitRepo(cwd, label) {
  if (!isGitWorkTree(cwd)) {
    log(`skip ${label}: not a git work tree`);
    return;
  }

  const safe = listSafeChangedPaths(cwd);
  if (safe === null) return;
  if (safe.length === 0) {
    log(`skip ${label}: clean (or only secrets)`);
    return;
  }

  const add = git(cwd, ["add", "--", ...safe]);
  if (add.status !== 0) {
    log(`git add failed in ${label}:`, (add.stderr || add.stdout || "").trim());
    return;
  }

  // Re-check index; nothing staged → nothing to commit
  const cached = git(cwd, ["diff", "--cached", "--name-only"]);
  if (cached.status !== 0 || !String(cached.stdout || "").trim()) {
    log(`skip ${label}: nothing staged`);
    return;
  }

  const message = buildCommitMessage(cwd, safe);
  const commit = git(cwd, ["commit", "-m", message]);
  if (commit.status !== 0) {
    log(`git commit failed in ${label}:`, (commit.stderr || commit.stdout || "").trim());
    return;
  }
  const short = String(commit.stdout || "")
    .trim()
    .split(/\r?\n/)[0];
  log(`committed ${label}: ${short || "ok"}`);
}

function main() {
  try {
    const skip = String(process.env.HDC_SKIP_AUTO_COMMIT || "")
      .trim()
      .toLowerCase();
    if (skip === "1" || skip === "true" || skip === "yes") {
      log("skipped (HDC_SKIP_AUTO_COMMIT)");
      respondEmpty();
      return;
    }

    const payload = readStdinJson();
    if (payload.status !== "completed") {
      respondEmpty();
      return;
    }

    commitRepo(HDC_ROOT, "hdc");

    const privateRoot = resolvePrivateRoot();
    if (privateRoot) {
      commitRepo(privateRoot, "hdc-private");
    } else {
      log("hdc-private root not found; skipped");
    }
  } catch (err) {
    log("unexpected error:", err?.message || err);
  }
  respondEmpty();
}

main();
