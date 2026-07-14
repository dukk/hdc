#!/usr/bin/env node
/**
 * hdc-scheduler — in-process cron for CLI jobs (no LLM).
 * Env: HDC_ROOT, HDC_PRIVATE_ROOT, HDC_AGENTS_META_ROOT, HDC_AGENT_ROLE=hdc-scheduler
 * Schedules: /opt/hdc-agents-meta/schedules.json or built-in defaults.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { cronMatches, defaultSchedules, normalizeSchedules } from "../lib/scheduler-catalog.mjs";
import { runScheduledCliJob } from "../lib/scheduler-job.mjs";

process.env.HDC_AGENT_ROLE = process.env.HDC_AGENT_ROLE || "hdc-scheduler";

const META = process.env.HDC_AGENTS_META_ROOT || "/opt/hdc-agents-meta";
const INSTALL = process.env.HDC_ROOT || "/opt/hdc";
const PRIVATE = process.env.HDC_PRIVATE_ROOT || "/opt/hdc-private";
const TICK_MS = 30_000;

mkdirSync(META, { recursive: true });
mkdirSync(join(META, "logs"), { recursive: true });

/**
 * @returns {Array<Record<string, unknown>>}
 */
function loadSchedules() {
  const p = join(META, "schedules.json");
  if (existsSync(p)) {
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      const list = normalizeSchedules(raw.schedules ?? raw);
      if (list.length) return list;
    } catch (e) {
      process.stderr.write(`[hdc-scheduler] schedules.json: ${e}\n`);
    }
  }
  return normalizeSchedules(defaultSchedules());
}

/** @type {Map<string, string>} scheduleId → last fired minute key */
const lastFired = new Map();

function minuteKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;
}

async function tick() {
  const now = new Date();
  const key = minuteKey(now);
  const schedules = loadSchedules();
  writeFileSync(
    join(META, "scheduler-heartbeat.json"),
    JSON.stringify({ at: now.toISOString(), schedules: schedules.map((s) => s.id) }, null, 2),
  );
  for (const schedule of schedules) {
    const id = String(schedule.id);
    if (!cronMatches(String(schedule.cron), now)) continue;
    if (lastFired.get(id) === key) continue;
    lastFired.set(id, key);
    try {
      process.stderr.write(`[hdc-scheduler] firing ${id}\n`);
      await runScheduledCliJob({
        schedule,
        installRoot: INSTALL,
        privateRoot: PRIVATE,
        metaRoot: META,
      });
    } catch (e) {
      process.stderr.write(
        `[hdc-scheduler] ${id} error: ${e instanceof Error ? e.message : e}\n`,
      );
    }
  }
}

process.stderr.write(
  `[hdc-scheduler] started meta=${META} install=${INSTALL} (tick every ${TICK_MS}ms)\n`,
);
await tick();
setInterval(() => {
  tick().catch((e) => process.stderr.write(`[hdc-scheduler] tick: ${e}\n`));
}, TICK_MS);
