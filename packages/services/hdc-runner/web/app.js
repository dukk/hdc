const API = "/api";

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/login")) {
    showLogin();
    throw new Error("authentication required");
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

function showLogin() {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
}

function showApp() {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.classList.add("hidden");
  try {
    await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: document.getElementById("login-user").value,
        password: document.getElementById("login-pass").value,
      }),
    });
    await initApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.classList.remove("hidden");
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => {});
  showLogin();
});

document.querySelectorAll("#nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#nav button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(`view-${btn.dataset.view}`).classList.remove("hidden");
    if (btn.dataset.view === "schedules") loadSchedules();
    if (btn.dataset.view === "tasks") loadTasks();
    if (btn.dataset.view === "jobs") loadJobs();
    if (btn.dataset.view === "inventory") loadInventory(currentInvCat);
    if (btn.dataset.view === "run") loadPackages();
    if (btn.dataset.view === "dashboard") loadDashboard();
  });
});

/** @type {string} */
let currentInvCat = "systems";
/** @type {ReturnType<typeof setInterval> | null} */
let jobsPoll = null;

async function initApp() {
  const me = await api("/auth/me");
  document.getElementById("user-label").textContent = me.user ?? "";
  showApp();
  loadDashboard();
  if (jobsPoll) clearInterval(jobsPoll);
  jobsPoll = setInterval(() => {
    const jobsView = document.getElementById("view-jobs");
    if (!jobsView.classList.contains("hidden")) loadJobs();
    const dash = document.getElementById("view-dashboard");
    if (!dash.classList.contains("hidden")) loadDashboard();
  }, 3000);
}

async function loadDashboard() {
  const [schedules, jobs] = await Promise.all([
    api("/schedules"),
    api("/jobs"),
  ]);
  const running = jobs.jobs?.find((j) => j.status === "running");
  const failed = (schedules.schedules ?? []).filter((s) => s.last_exit_code != null && s.last_exit_code !== 0);
  const stats = document.getElementById("dashboard-stats");
  stats.innerHTML = `
    <div class="card"><span class="muted">Schedules</span><strong>${schedules.schedules?.length ?? 0}</strong></div>
    <div class="card"><span class="muted">Recent jobs</span><strong>${jobs.jobs?.length ?? 0}</strong></div>
    <div class="card"><span class="muted">Failed schedules</span><strong class="${failed.length ? "exit-fail" : "exit-ok"}">${failed.length}</strong></div>
  `;
  const banner = document.getElementById("active-job-banner");
  if (running) {
    banner.textContent = `Job running: ${running.type} ${running.schedule_id || `${running.tier}/${running.package}/${running.verb}`} (started ${running.started_at})`;
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

async function loadTasks() {
  const [data, report] = await Promise.all([
    api("/tasks"),
    api("/tasks/report"),
  ]);
  const tbody = document.querySelector("#tasks-table tbody");
  tbody.innerHTML = "";
  for (const t of data.tasks ?? []) {
    const tr = document.createElement("tr");
    const canApprove = t.status === "pending";
    const canRun = t.status === "pending" || t.status === "approved";
    tr.innerHTML = `
      <td><code>${escapeHtml(t.id)}</code></td>
      <td>${escapeHtml(t.role)}</td>
      <td>${escapeHtml(t.priority)}</td>
      <td>${escapeHtml(t.status)}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>
        ${canApprove ? `<button type="button" class="btn btn-sm btn-secondary" data-action="approve" data-id="${escapeHtml(t.id)}">Approve</button>` : ""}
        ${canRun ? `<button type="button" class="btn btn-sm" data-action="run" data-id="${escapeHtml(t.id)}">Run agent</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById("task-report").textContent = report.markdown ?? "";
  tbody.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      try {
        if (btn.dataset.action === "approve") {
          await api(`/tasks/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "approved" }),
          });
        }
        if (btn.dataset.action === "run") {
          await api(`/tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
        }
        loadTasks();
        loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function loadSchedules() {
  const data = await api("/schedules");
  const tbody = document.querySelector("#schedules-table tbody");
  tbody.innerHTML = "";
  for (const s of data.schedules ?? []) {
    const tr = document.createElement("tr");
    const cli = [...(s.cli ?? []), ...(s.cli_args?.length ? ["--", ...s.cli_args] : [])].join(" ");
    const exitClass = s.last_exit_code === 0 ? "exit-ok" : s.last_exit_code != null ? "exit-fail" : "";
    tr.innerHTML = `
      <td><code>${escapeHtml(s.id)}</code></td>
      <td><code>${escapeHtml(s.cron ?? "")}</code></td>
      <td><code>${escapeHtml(cli)}</code></td>
      <td>${escapeHtml(s.last_run_iso ?? "—")}</td>
      <td class="${exitClass}">${s.last_exit_code ?? "—"}</td>
      <td>
        <button type="button" class="btn btn-sm btn-secondary" data-action="log" data-id="${escapeHtml(s.id)}">Log</button>
        <button type="button" class="btn btn-sm" data-action="run" data-id="${escapeHtml(s.id)}">Run now</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === "log") showScheduleLog(id);
      if (btn.dataset.action === "run") {
        await api(`/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });
        loadSchedules();
        loadDashboard();
      }
    });
  });
}

async function showScheduleLog(id) {
  const detail = document.getElementById("schedule-detail");
  detail.classList.remove("hidden");
  document.getElementById("schedule-detail-title").textContent = `Schedule: ${id}`;
  const parsed = await api(`/schedules/${encodeURIComponent(id)}/log?parsed=1`);
  const runsEl = document.getElementById("schedule-runs");
  runsEl.innerHTML = (parsed.runs ?? [])
    .map(
      (r) =>
        `<div class="${r.exit_code === 0 ? "exit-ok" : "exit-fail"}">${r.started_at ?? "?"} → ${r.finished_at ?? "running"} exit=${r.exit_code ?? "?"}</div>`,
    )
    .join("");
  const log = await api(`/schedules/${encodeURIComponent(id)}/log`);
  document.getElementById("schedule-log").textContent = log.text ?? "";
}

/** @type {{ packages: { tier: string; id: string; title: string; verbs: string[] }[] } | null} */
let packageCatalog = null;

async function loadPackages() {
  if (!packageCatalog) packageCatalog = await api("/packages");
  const tierSel = document.getElementById("run-tier");
  const pkgSel = document.getElementById("run-package");
  const verbSel = document.getElementById("run-verb");
  const tiers = [...new Set(packageCatalog.packages.map((p) => p.tier))];
  tierSel.innerHTML = tiers.map((t) => `<option value="${t}">${t}</option>`).join("");
  const updatePackages = () => {
    const tier = tierSel.value;
    const pkgs = packageCatalog.packages.filter((p) => p.tier === tier);
    pkgSel.innerHTML = pkgs.map((p) => `<option value="${p.id}">${p.title} (${p.id})</option>`).join("");
    updateVerbs();
  };
  const updateVerbs = () => {
    const tier = tierSel.value;
    const pkg = pkgSel.value;
    const found = packageCatalog.packages.find((p) => p.tier === tier && p.id === pkg);
    verbSel.innerHTML = (found?.verbs ?? []).map((v) => `<option value="${v}">${v}</option>`).join("");
  };
  tierSel.onchange = updatePackages;
  pkgSel.onchange = updateVerbs;
  updatePackages();
}

document.getElementById("run-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("run-error");
  errEl.classList.add("hidden");
  try {
    await api("/jobs", {
      method: "POST",
      body: JSON.stringify({
        tier: document.getElementById("run-tier").value,
        package: document.getElementById("run-package").value,
        verb: document.getElementById("run-verb").value,
        args_string: document.getElementById("run-args").value,
      }),
    });
    document.querySelector('#nav button[data-view="jobs"]').click();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
  }
});

/** @type {string | null} */
let selectedJobId = null;

async function loadJobs() {
  const data = await api("/jobs");
  const list = document.getElementById("jobs-list");
  list.innerHTML = "";
  for (const j of data.jobs ?? []) {
    const div = document.createElement("div");
    div.className = "job-row";
    const label =
      j.type === "schedule"
        ? `schedule:${j.schedule_id}`
        : j.type === "agent-task"
          ? `agent-task:${j.task_id}`
          : `${j.tier}/${j.package}/${j.verb}`;
    div.innerHTML = `<span><strong>${escapeHtml(label)}</strong> <span class="muted">${j.status} · ${j.started_at ?? ""}</span></span><span class="${j.exit_code === 0 ? "exit-ok" : j.status === "running" ? "" : "exit-fail"}">${j.exit_code ?? j.status}</span>`;
    div.addEventListener("click", () => showJobLog(j.id));
    list.appendChild(div);
  }
  if (selectedJobId) showJobLog(selectedJobId);
}

async function showJobLog(id) {
  selectedJobId = id;
  const data = await api(`/jobs/${encodeURIComponent(id)}`);
  const el = document.getElementById("job-log");
  el.classList.remove("hidden");
  el.textContent = data.log ?? "";
}

document.querySelectorAll(".inv-tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".inv-tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentInvCat = btn.dataset.cat;
    loadInventory(currentInvCat);
  });
});

document.getElementById("inv-search").addEventListener("input", () => {
  loadInventory(currentInvCat);
});

/** @type {unknown[]} */
let invItems = [];

async function loadInventory(category) {
  const data = await api(`/inventory/${category}`);
  invItems = data.items ?? [];
  const q = document.getElementById("inv-search").value.toLowerCase();
  const filtered = invItems.filter((item) => {
    const text = JSON.stringify(item).toLowerCase();
    return !q || text.includes(q);
  });
  const tbody = document.querySelector("#inv-table tbody");
  tbody.innerHTML = "";
  for (const item of filtered) {
    const tr = document.createElement("tr");
    const details = item.primary_ip || item.hostname || item.name || "";
    tr.innerHTML = `
      <td><code>${escapeHtml(String(item.id ?? ""))}</code></td>
      <td>${escapeHtml(String(item.kind ?? ""))}</td>
      <td>${escapeHtml(String(details))}</td>
    `;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showInvDetail(category, String(item.id)));
    tbody.appendChild(tr);
  }
}

async function showInvDetail(category, id) {
  const data = await api(`/inventory/${category}/${encodeURIComponent(id)}`);
  const el = document.getElementById("inv-detail");
  el.classList.remove("hidden");
  el.textContent = JSON.stringify(data.record, null, 2);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

(async () => {
  try {
    await api("/auth/me");
    await initApp();
  } catch {
    showLogin();
  }
})();
