import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "Tasks" },
  { id: "schedules", label: "Schedules" },
  { id: "run", label: "Run package" },
  { id: "jobs", label: "Jobs" },
  { id: "inventory", label: "Inventory" },
];

const INV_CATS = ["systems", "services", "networks", "targets"];

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [loginError, setLoginError] = useState("");
  const [oidcConfigured, setOidcConfigured] = useState(false);

  const refreshMe = useCallback(async () => {
    const me = await api("/auth/me");
    setUser(me.user ?? null);
    setOidcConfigured(me.oidc_configured === true);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshMe();
      } catch (err) {
        setUser(null);
        setLoginError(err instanceof Error ? err.message : String(err));
      } finally {
        setAuthChecked(true);
      }
    })();
  }, [refreshMe]);

  function onSsoLogin() {
    setLoginError("");
    window.location.href = "/api/auth/oidc/login";
  }

  async function onLogout() {
    try {
      const result = await api("/auth/logout", { method: "POST" });
      if (result && typeof result.logout_url === "string" && result.logout_url) {
        window.location.href = result.logout_url;
        return;
      }
    } catch {
      /* ignore */
    }
    setUser(null);
  }

  if (!authChecked) {
    return <div className="loading">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="panel">
        <h1>HDC Web</h1>
        <p className="muted">Sign in with SSO to manage scheduled jobs, tasks, and inventory.</p>
        <button type="button" onClick={onSsoLogin} disabled={!oidcConfigured}>
          Sign in with SSO
        </button>
        {!oidcConfigured ? (
          <p className="error">OIDC is not configured on this server.</p>
        ) : null}
        {loginError ? <p className="error">{loginError}</p> : null}
      </div>
    );
  }

  return (
    <>
      <header>
        <h1>HDC Web</h1>
        <nav>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <span className="muted">{user}</span>
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {tab === "dashboard" && <Dashboard />}
        {tab === "tasks" && <Tasks onRan={() => setTab("jobs")} />}
        {tab === "schedules" && <Schedules onRan={() => setTab("jobs")} />}
        {tab === "run" && <RunPackage onStarted={() => setTab("jobs")} />}
        {tab === "jobs" && <Jobs />}
        {tab === "inventory" && <Inventory />}
      </main>
    </>
  );
}

function Dashboard() {
  const [schedules, setSchedules] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([api("/schedules"), api("/jobs")]);
      setSchedules(s.schedules ?? []);
      setJobs(j.jobs ?? []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const running = jobs.find((j) => j.status === "running");
  const failed = schedules.filter((s) => s.last_exit_code != null && s.last_exit_code !== 0);

  return (
    <section>
      <h2>Dashboard</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="cards">
        <div className="card">
          <span className="muted">Schedules</span>
          <strong>{schedules.length}</strong>
        </div>
        <div className="card">
          <span className="muted">Recent jobs</span>
          <strong>{jobs.length}</strong>
        </div>
        <div className="card">
          <span className="muted">Failed schedules</span>
          <strong className={failed.length ? "exit-fail" : "exit-ok"}>{failed.length}</strong>
        </div>
      </div>
      {running ? (
        <div className="banner">
          Job running: {running.type}{" "}
          {running.schedule_id || `${running.tier}/${running.package}/${running.verb}`} (started{" "}
          {running.started_at})
        </div>
      ) : null}
    </section>
  );
}

function Tasks({ onRan }) {
  const [tasks, setTasks] = useState([]);
  const [report, setReport] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([api("/tasks"), api("/tasks/report")]);
      setTasks(t.tasks ?? []);
      setReport(r.markdown ?? "");
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(id) {
    try {
      await api(`/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "approved" }),
      });
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  async function run(id) {
    try {
      await api(`/tasks/${encodeURIComponent(id)}/run`, { method: "POST" });
      load();
      onRan?.();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <section>
      <h2>Agent tasks</h2>
      <p className="muted">Guest-authoritative task queue. Approve tasks, then run assigned agents.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Role</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Title</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <code>{t.id}</code>
                </td>
                <td>{t.role}</td>
                <td>{t.priority}</td>
                <td>{t.status}</td>
                <td>{t.title}</td>
                <td>
                  {t.status === "pending" ? (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => approve(t.id)}>
                      Approve
                    </button>
                  ) : null}
                  {t.status === "pending" || t.status === "approved" ? (
                    <button type="button" className="btn btn-sm" onClick={() => run(t.id)}>
                      Run agent
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <pre className="log">{report}</pre>
    </section>
  );
}

function Schedules({ onRan }) {
  const [schedules, setSchedules] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api("/schedules");
      setSchedules(data.schedules ?? []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function showLog(id) {
    const parsed = await api(`/schedules/${encodeURIComponent(id)}/log?parsed=1`);
    const log = await api(`/schedules/${encodeURIComponent(id)}/log`);
    setDetail({ id, runs: parsed.runs ?? [], text: log.text ?? "" });
  }

  async function runNow(id) {
    try {
      await api(`/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });
      load();
      onRan?.();
    } catch (e) {
      alert(e.message);
    }
  }

  return (
    <section>
      <h2>Schedules</h2>
      {error ? <p className="error">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Cron</th>
              <th>Command</th>
              <th>Last run</th>
              <th>Exit</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => {
              const cli = [...(s.cli ?? []), ...(s.cli_args?.length ? ["--", ...s.cli_args] : [])].join(
                " ",
              );
              const exitClass =
                s.last_exit_code === 0 ? "exit-ok" : s.last_exit_code != null ? "exit-fail" : "";
              return (
                <tr key={s.id}>
                  <td>
                    <code>{s.id}</code>
                  </td>
                  <td>
                    <code>{s.cron ?? ""}</code>
                  </td>
                  <td>
                    <code>{cli}</code>
                  </td>
                  <td>{s.last_run_iso ?? "—"}</td>
                  <td className={exitClass}>{s.last_exit_code ?? "—"}</td>
                  <td>
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => showLog(s.id)}>
                      Log
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => runNow(s.id)}>
                      Run now
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail ? (
        <div className="panel inline">
          <h3>Schedule: {detail.id}</h3>
          <div>
            {detail.runs.map((r, i) => (
              <div key={i} className={r.exit_code === 0 ? "exit-ok" : "exit-fail"}>
                {r.started_at ?? "?"} → {r.finished_at ?? "running"} exit={r.exit_code ?? "?"}
              </div>
            ))}
          </div>
          <pre className="log">{detail.text}</pre>
        </div>
      ) : null}
    </section>
  );
}

function RunPackage({ onStarted }) {
  const [catalog, setCatalog] = useState(null);
  const [tier, setTier] = useState("");
  const [pkg, setPkg] = useState("");
  const [verb, setVerb] = useState("");
  const [args, setArgs] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/packages").then((c) => {
      setCatalog(c);
      const tiers = [...new Set((c.packages ?? []).map((p) => p.tier))];
      if (tiers[0]) setTier(tiers[0]);
    });
  }, []);

  const packages = (catalog?.packages ?? []).filter((p) => p.tier === tier);
  const verbs = packages.find((p) => p.id === pkg)?.verbs ?? [];

  useEffect(() => {
    if (packages[0] && !packages.some((p) => p.id === pkg)) {
      setPkg(packages[0].id);
    }
  }, [tier, packages, pkg]);

  useEffect(() => {
    if (verbs[0] && !verbs.includes(verb)) setVerb(verbs[0]);
  }, [pkg, verbs, verb]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await api("/jobs", {
        method: "POST",
        body: JSON.stringify({
          tier,
          package: pkg,
          verb,
          args_string: args,
        }),
      });
      onStarted?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const tiers = [...new Set((catalog?.packages ?? []).map((p) => p.tier))];

  return (
    <section>
      <h2>Run package</h2>
      <form className="panel inline" onSubmit={onSubmit}>
        <label>
          Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)} required>
            {tiers.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Package
          <select value={pkg} onChange={(e) => setPkg(e.target.value)} required>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Verb
          <select value={verb} onChange={(e) => setVerb(e.target.value)} required>
            {verbs.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arguments (after --)
          <input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="--dry-run --instance a"
          />
        </label>
        <button type="submit">Start job</button>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </section>
  );
}

function Jobs() {
  const [jobs, setJobs] = useState([]);
  const [log, setLog] = useState("");
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    const data = await api("/jobs");
    setJobs(data.jobs ?? []);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  async function showLog(id) {
    setSelected(id);
    const data = await api(`/jobs/${encodeURIComponent(id)}`);
    setLog(data.log ?? "");
  }

  useEffect(() => {
    if (!selected) return;
    api(`/jobs/${encodeURIComponent(selected)}`)
      .then((data) => setLog(data.log ?? ""))
      .catch(() => {});
  }, [jobs, selected]);

  return (
    <section>
      <h2>Jobs</h2>
      <div>
        {jobs.map((j) => {
          const label =
            j.type === "schedule"
              ? `schedule:${j.schedule_id}`
              : j.type === "agent-task"
                ? `agent-task:${j.task_id}`
                : `${j.tier}/${j.package}/${j.verb}`;
          return (
            <div key={j.id} className="job-row" onClick={() => showLog(j.id)}>
              <span>
                <strong>{label}</strong>{" "}
                <span className="muted">
                  {j.status} · {j.started_at ?? ""}
                </span>
              </span>
              <span
                className={
                  j.exit_code === 0 ? "exit-ok" : j.status === "running" ? "" : "exit-fail"
                }
              >
                {j.exit_code ?? j.status}
              </span>
            </div>
          );
        })}
      </div>
      {selected ? <pre className="log">{log}</pre> : null}
    </section>
  );
}

function Inventory() {
  const [category, setCategory] = useState("systems");
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    api(`/inventory/${category}`).then((data) => setItems(data.items ?? []));
    setDetail("");
  }, [category]);

  const filtered = items.filter((item) => {
    const text = JSON.stringify(item).toLowerCase();
    return !q || text.includes(q.toLowerCase());
  });

  async function showDetail(id) {
    const data = await api(`/inventory/${category}/${encodeURIComponent(id)}`);
    setDetail(JSON.stringify(data.record, null, 2));
  }

  return (
    <section>
      <h2>Inventory</h2>
      <div className="inv-tabs">
        {INV_CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={category === c ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c.charAt(0).toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <input
        className="inv-search"
        type="search"
        placeholder="Filter by id or name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Kind</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} style={{ cursor: "pointer" }} onClick={() => showDetail(item.id)}>
                <td>
                  <code>{item.id}</code>
                </td>
                <td>{item.kind}</td>
                <td>{item.primary_ip || item.hostname || item.name || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail ? <pre className="log">{detail}</pre> : null}
    </section>
  );
}
