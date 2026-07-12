/**
 * Parse scheduled job log markers written by run-scheduled-job.mjs.
 *
 * @param {string} text
 * @returns {{ started_at: string | null; finished_at: string | null; exit_code: number | null }[]}
 */
export function parseScheduleLogRuns(text) {
  const runs = /** @type {{ started_at: string | null; finished_at: string | null; exit_code: number | null }[]} */ (
    []
  );
  if (!text) return runs;

  /** @type {{ started_at: string | null; finished_at: string | null; exit_code: number | null }} */
  let current = { started_at: null, finished_at: null, exit_code: null };

  for (const line of text.split(/\r?\n/)) {
    const startMatch = line.match(/^=== ([0-9T:.+-]+Z?) job .+ started ===$/);
    if (startMatch) {
      if (current.started_at || current.finished_at) {
        runs.push(current);
      }
      current = { started_at: startMatch[1], finished_at: null, exit_code: null };
      continue;
    }
    const endMatch = line.match(/^--- ([0-9T:.+-]+Z?) exit=(-?\d+) ---$/);
    if (endMatch) {
      current.finished_at = endMatch[1];
      current.exit_code = Number(endMatch[2]);
      runs.push(current);
      current = { started_at: null, finished_at: null, exit_code: null };
    }
  }

  if (current.started_at || current.finished_at) {
    runs.push(current);
  }

  return runs;
}

/**
 * Last completed run summary from log text.
 *
 * @param {string} text
 * @returns {{ last_run_iso: string | null; last_exit_code: number | null }}
 */
export function lastScheduleLogRun(text) {
  const runs = parseScheduleLogRuns(text);
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.finished_at !== null && run.exit_code !== null) {
      return { last_run_iso: run.finished_at, last_exit_code: run.exit_code };
    }
  }
  return { last_run_iso: null, last_exit_code: null };
}

/**
 * Shell one-liner for guest query (legacy query --live).
 *
 * @param {string} metaRoot
 */
export function buildScheduleStatusScript(metaRoot) {
  const GUEST_NODE = "/usr/bin/node";
  const meta = metaRoot.replace(/'/g, `'\\''`);
  return [
    `${GUEST_NODE} -e "`,
    "const fs=require('fs');",
    "const path=require('path');",
    `const meta='${meta}';`,
    "let schedules=[];",
    "try{schedules=JSON.parse(fs.readFileSync(path.join(meta,'schedules.json'),'utf8')).schedules||[];}catch(e){process.stdout.write(JSON.stringify({error:String(e)}));process.exit(0);}",
    "const out=[];",
    "for(const s of schedules){",
    "  const id=String(s.id||'').trim();",
    "  if(!id) continue;",
    "  const logPath='/var/log/hdc-runner/'+id+'.log';",
    "  const row={id,cron_file:'/etc/cron.d/hdc-runner-'+id,log_path:logPath,log_bytes:0,last_run_iso:null,last_exit_code:null};",
    "  try{",
    "    const st=fs.statSync(logPath);",
    "    row.log_bytes=st.size;",
    "    const text=fs.readFileSync(logPath,'utf8');",
    "    const m=text.match(/--- ([0-9T:.+-]+Z?) exit=(-?\\d+) ---(?!\\n---)/g);",
    "    if(m&&m.length){",
    "      const last=m[m.length-1];",
    "      const p=last.match(/--- ([0-9T:.+-]+Z?) exit=(-?\\d+) ---/);",
    "      if(p){row.last_run_iso=p[1];row.last_exit_code=Number(p[2]);}",
    "    }",
    "  }catch{}",
    "  out.push(row);",
    "}",
    "process.stdout.write(JSON.stringify(out));",
    `"`,
  ].join("");
}
