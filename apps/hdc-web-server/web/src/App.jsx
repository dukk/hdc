import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import {
  Banner,
  Button,
  CardGrid,
  Field,
  ListRow,
  LogView,
  Message,
  Panel,
  SearchInput,
  SelectInput,
  Spinner,
  StatCard,
  StatusText,
  Table,
  Tabs,
  TextInput,
} from "./ui/index.js";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "Tasks" },
  { id: "research", label: "Research" },
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
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(false);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const refreshMe = useCallback(async () => {
    const me = await api("/auth/me");
    setUser(me.user ?? null);
    setOidcConfigured(me.oidc_configured === true);
    setPasswordLoginEnabled(me.password_login_enabled === true);
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

  async function onPasswordLogin(e) {
    e.preventDefault();
    setLoginError("");
    setLoginBusy(true);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: loginUsername, password: loginPassword }),
      });
      setLoginPassword("");
      await refreshMe();
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoginBusy(false);
    }
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
    return <Spinner />;
  }

  if (!user) {
    return (
      <Panel>
        <h1>HDC Web</h1>
        <Message>Sign in to manage scheduled jobs, tasks, and inventory.</Message>
        {passwordLoginEnabled ? (
          <form onSubmit={onPasswordLogin}>
            <Field label="Username">
              <TextInput
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
                disabled={loginBusy}
              />
            </Field>
            <Field label="Password">
              <TextInput
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loginBusy}
              />
            </Field>
            <Button type="submit" disabled={loginBusy || !loginUsername || !loginPassword}>
              Sign in
            </Button>
          </form>
        ) : null}
        {oidcConfigured ? (
          <>
            {passwordLoginEnabled ? <Message>Or sign in with SSO.</Message> : null}
            <Button onClick={onSsoLogin} disabled={loginBusy} variant={passwordLoginEnabled ? "secondary" : undefined}>
              Sign in with SSO
            </Button>
          </>
        ) : null}
        {!passwordLoginEnabled && !oidcConfigured ? (
          <Message tone="error">No login method is configured on this server.</Message>
        ) : null}
        {loginError ? <Message tone="error">{loginError}</Message> : null}
      </Panel>
    );
  }

  return (
    <>
      <header>
        <h1>HDC Web</h1>
        <Tabs tabs={TABS} activeId={tab} onSelect={setTab} />
        <div className="header-actions">
          <span className="muted">{user}</span>
          <Button variant="secondary" onClick={onLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <main>
        {tab === "dashboard" && <Dashboard />}
        {tab === "tasks" && <Tasks onRan={() => setTab("jobs")} />}
        {tab === "research" && <Research />}
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
      {error ? <Message tone="error">{error}</Message> : null}
      <CardGrid>
        <StatCard label="Schedules" value={schedules.length} />
        <StatCard label="Recent jobs" value={jobs.length} />
        <StatCard label="Failed schedules" value={failed.length} tone={failed.length ? "fail" : "ok"} />
      </CardGrid>
      {running ? (
        <Banner>
          Job running: {running.type}{" "}
          {running.schedule_id || `${running.tier}/${running.package}/${running.verb}`} (started{" "}
          {running.started_at})
        </Banner>
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

  const columns = [
    { key: "id", header: "ID", render: (t) => <code>{t.id}</code> },
    { key: "role", header: "Role", render: (t) => t.role },
    { key: "priority", header: "Priority", render: (t) => t.priority },
    { key: "status", header: "Status", render: (t) => t.status },
    { key: "title", header: "Title", render: (t) => t.title },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <>
          {t.status === "pending" ? (
            <Button size="sm" variant="secondary" onClick={() => approve(t.id)}>
              Approve
            </Button>
          ) : null}
          {t.status === "pending" || t.status === "approved" ? (
            <Button size="sm" onClick={() => run(t.id)}>
              Run agent
            </Button>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <section>
      <h2>Agent tasks</h2>
      <Message>Guest-authoritative task queue. Approve tasks, then run assigned agents.</Message>
      {error ? <Message tone="error">{error}</Message> : null}
      <Table columns={columns} rows={tasks} rowKey={(t) => t.id} />
      <LogView>{report}</LogView>
    </section>
  );
}

function Research() {
  const [data, setData] = useState({ topics: [], index: "", suggestions: "" });
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api("/research");
      setData({
        topics: r.topics ?? [],
        index: r.index ?? "",
        suggestions: r.suggestions ?? "",
      });
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitSuggestion(e) {
    e.preventDefault();
    setMessage("");
    try {
      await api("/research/suggestions", {
        method: "POST",
        body: JSON.stringify({
          title,
          url: url || undefined,
          body: body || undefined,
        }),
      });
      setTitle("");
      setUrl("");
      setBody("");
      setMessage("Suggestion added to inbox. Manager triage promotes topics to queued.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const columns = [
    { key: "id", header: "ID", render: (t) => <code>{t.id}</code> },
    { key: "title", header: "Title", render: (t) => t.title },
    { key: "status", header: "Status", render: (t) => t.status },
    { key: "outcome", header: "Outcome", render: (t) => t.outcome || "—" },
    {
      key: "report",
      header: "Report",
      render: (t) => (t.report ? <code>{t.report}</code> : "—"),
    },
  ];

  return (
    <section>
      <h2>Research</h2>
      <Message>
        Topic index, suggestion inbox, and new ideas. Email manager@hdc.dukk.org with subject{" "}
        <code>Research: &lt;title&gt;</code> or edit suggestions in hdc-private.
      </Message>
      {error ? <Message tone="error">{error}</Message> : null}
      {message ? <Message tone="ok">{message}</Message> : null}

      <h3>Topic index</h3>
      <Table columns={columns} rows={data.topics} rowKey={(t) => t.id} />
      <LogView>{data.index}</LogView>

      <h3>Suggest a topic</h3>
      <Panel as="form" onSubmit={submitSuggestion}>
        <Field label="Title">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="URL (optional)">
          <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Notes (optional)">
          <TextInput value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <Button type="submit">Add suggestion</Button>
      </Panel>

      <h3>Suggestions inbox</h3>
      <LogView>{data.suggestions || "(empty)"}</LogView>
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

  const cliOf = (s) =>
    [...(s.cli ?? []), ...(s.cli_args?.length ? ["--", ...s.cli_args] : [])].join(" ");

  const columns = [
    { key: "id", header: "ID", render: (s) => <code>{s.id}</code> },
    { key: "cron", header: "Cron", render: (s) => <code>{s.cron ?? ""}</code> },
    { key: "cmd", header: "Command", render: (s) => <code>{cliOf(s)}</code> },
    { key: "last", header: "Last run", render: (s) => s.last_run_iso ?? "—" },
    {
      key: "exit",
      header: "Exit",
      render: (s) => <StatusText exitCode={s.last_exit_code}>{s.last_exit_code ?? "—"}</StatusText>,
    },
    {
      key: "actions",
      header: "",
      render: (s) => (
        <>
          <Button size="sm" variant="secondary" onClick={() => showLog(s.id)}>
            Log
          </Button>
          <Button size="sm" onClick={() => runNow(s.id)}>
            Run now
          </Button>
        </>
      ),
    },
  ];

  return (
    <section>
      <h2>Schedules</h2>
      {error ? <Message tone="error">{error}</Message> : null}
      <Table columns={columns} rows={schedules} rowKey={(s) => s.id} />
      {detail ? (
        <Panel inline>
          <h3>Schedule: {detail.id}</h3>
          <div>
            {detail.runs.map((r, i) => (
              <StatusText key={i} exitCode={r.exit_code}>
                {r.started_at ?? "?"} → {r.finished_at ?? "running"} exit={r.exit_code ?? "?"}
              </StatusText>
            ))}
          </div>
          <LogView>{detail.text}</LogView>
        </Panel>
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
      <Panel inline as="form" onSubmit={onSubmit}>
        <Field label="Tier">
          <SelectInput
            value={tier}
            onChange={setTier}
            required
            options={tiers.map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="Package">
          <SelectInput
            value={pkg}
            onChange={setPkg}
            required
            options={packages.map((p) => ({ value: p.id, label: `${p.title} (${p.id})` }))}
          />
        </Field>
        <Field label="Verb">
          <SelectInput
            value={verb}
            onChange={setVerb}
            required
            options={verbs.map((v) => ({ value: v, label: v }))}
          />
        </Field>
        <Field label="Arguments (after --)">
          <TextInput value={args} onChange={setArgs} placeholder="--dry-run --instance a" />
        </Field>
        <Button type="submit">Start job</Button>
        {error ? <Message tone="error">{error}</Message> : null}
      </Panel>
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
          const tone = j.exit_code === 0 ? "ok" : j.status === "running" ? "neutral" : "fail";
          return (
            <ListRow
              key={j.id}
              onClick={() => showLog(j.id)}
              left={
                <>
                  <strong>{label}</strong>{" "}
                  <span className="muted">
                    {j.status} · {j.started_at ?? ""}
                  </span>
                </>
              }
              right={<StatusText tone={tone}>{j.exit_code ?? j.status}</StatusText>}
            />
          );
        })}
      </div>
      {selected ? <LogView>{log}</LogView> : null}
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

  const catTabs = INV_CATS.map((c) => ({ id: c, label: c.charAt(0).toUpperCase() + c.slice(1) }));

  const columns = [
    { key: "id", header: "ID", render: (item) => <code>{item.id}</code> },
    { key: "kind", header: "Kind", render: (item) => item.kind },
    {
      key: "details",
      header: "Details",
      render: (item) => item.primary_ip || item.hostname || item.name || "",
    },
  ];

  return (
    <section>
      <h2>Inventory</h2>
      <Tabs tabs={catTabs} activeId={category} onSelect={setCategory} />
      <SearchInput value={q} onChange={setQ} placeholder="Filter by id or name…" />
      <Table columns={columns} rows={filtered} rowKey={(item) => item.id} onRowClick={(item) => showDetail(item.id)} />
      {detail ? <LogView>{detail}</LogView> : null}
    </section>
  );
}
