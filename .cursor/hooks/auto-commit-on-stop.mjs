#!/usr/bin/env node
/**
 * Cursor `stop` hook: when the agent finishes successfully and hdc / hdc-private
 * have safe dirty paths, emit a followup that asks the agent to summarize with
 * Conventional Commits and commit (never push). The hook itself does not commit.
 *
 * Escape hatch: HDC_SKIP_AUTO_COMMIT=1
 *
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HDC_ROOT = path.resolve(__dirname, "..", "..");

/** Matches stop.loop_limit in hooks.json — stop asking once this many follow-ups ran. */
const MAX_LOOP_COUNT = 2;

/** Path basenames that must never be auto-committed. */
const SECRET_BASENAME_RE = /^(?:\.env|\.env\..+|vault\.enc|.*\.enc)$/i;

function respondEmpty() {
  process.stdout.write("{}\n");
}

function respondFollowup(message) {
  process.stdout.write(JSON.stringify({ followup_message: message }) + "\n");
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
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...opts,
  });
}

function isGitWorkTree(cwd) {
  const r = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.status === 0 && String(r.stdout).trim() === "true";
}

function resolvePrivateRoot() {
  const fromEnv = process.env.HDC_PRIVATE_ROOT?.trim();
  if (fromEnv) {
    // Explicit override: do not fall back to sibling when missing.
    const resolved = path.resolve(fromEnv);
    return fs.existsSync(resolved) ? resolved : null;
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
  return filePath.replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');
}

function isSecretPath(relPath) {
  const normalized = relPath.replace(/\\/g, "/");
  const base = path.posix.basename(normalized);
  if (SECRET_BASENAME_RE.test(base)) return true;
  if (/(^|\/)\.env($|\.)/i.test(normalized)) return true;
  if (/(^|\/)vault\.enc$/i.test(normalized)) return true;
  return false;
}

function listSafeChangedPaths(cwd) {
  if (!isGitWorkTree(cwd)) return null;
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
    log(`secret paths present in ${path.basename(cwd)} (do not stage):`, skippedSecrets.join(", "));
  }
  return safe;
}

function formatPathList(paths, limit = 20) {
  const shown = paths.slice(0, limit).map((p) => `- \`${p.replace(/\\/g, "/")}\``);
  if (paths.length > limit) {
    shown.push(`- ...and ${paths.length - limit} more`);
  }
  return shown.join("\n");
}

function buildFollowupMessage(repos) {
  const repoBlocks = repos
    .map(
      ({ label, root, paths }) =>
        `### ${label}\nRoot: \`${root}\`\nChanged files (${paths.length}):\n${formatPathList(paths)}`,
    )
    .join("\n\n");

  return [
    "Auto-commit follow-up: uncommitted changes remain after the previous turn.",
    "",
    "For each dirty repo below:",
    "1. Run `git status` and `git diff` (plus `git diff --stat`) in that root.",
    "2. Stage only non-secret paths. Never stage `.env`, `.env.*`, `*.enc`, or `vault.enc`.",
    "3. Write a [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) message:",
    "   - Form: `type(optional-scope): short description`",
    "   - Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`",
    "   - Prefer a scope from the primary area (e.g. `crowdsec`, `azure`, `hooks`)",
    "   - Description focuses on **why**; optional short body after a blank line",
    "   - Use `BREAKING CHANGE:` / `!` only if the change is actually breaking",
    "4. Commit with that message (HEREDOC / multi-line `-m` as needed). Separate commit per dirty repo.",
    "5. Do **not** push, amend, or use `--no-verify`.",
    "6. After committing, stop — do not start unrelated work.",
    "",
    repoBlocks,
  ].join("\n");
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

    const loopCount = typeof payload.loop_count === "number" ? payload.loop_count : 0;
    if (loopCount >= MAX_LOOP_COUNT) {
      log(`skip follow-up: loop_count=${loopCount} >= ${MAX_LOOP_COUNT}`);
      respondEmpty();
      return;
    }

    /** @type {{ label: string, root: string, paths: string[] }[]} */
    const dirty = [];

    const hdcPaths = listSafeChangedPaths(HDC_ROOT);
    if (hdcPaths && hdcPaths.length > 0) {
      dirty.push({ label: "hdc", root: HDC_ROOT, paths: hdcPaths });
    }

    const privateRoot = resolvePrivateRoot();
    if (privateRoot) {
      const privPaths = listSafeChangedPaths(privateRoot);
      if (privPaths && privPaths.length > 0) {
        dirty.push({ label: "hdc-private", root: privateRoot, paths: privPaths });
      }
    } else {
      log("hdc-private root not found; skipped");
    }

    if (dirty.length === 0) {
      log("no safe dirty paths; nothing to follow up");
      respondEmpty();
      return;
    }

    log(
      `requesting conventional-commit follow-up for: ${dirty.map((d) => d.label).join(", ")} (loop_count=${loopCount})`,
    );
    respondFollowup(buildFollowupMessage(dirty));
  } catch (err) {
    log("unexpected error:", err?.message || err);
    respondEmpty();
  }
}

main();
