import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
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
  StatCard,
  StatusText,
  Table,
  Tabs,
  TextInput,
} from "./ui/index.js";

function Row({ title, children }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h3 style={{ color: "var(--muted)", fontWeight: 500 }}>{title}</h3>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        {children}
      </div>
    </section>
  );
}

function Gallery() {
  const [tab, setTab] = useState("a");
  const [txt, setTxt] = useState("--dry-run");
  const [sel, setSel] = useState("service");
  const [q, setQ] = useState("");

  const rows = [
    { id: "vm-bind-a", role: "hdc-sre", status: "pending", exit: 0 },
    { id: "litellm-a", role: "hdc-monitor", status: "approved", exit: 1 },
  ];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
      <h1>HDC UI gallery</h1>

      <Row title="Button">
        <Button>Start job</Button>
        <Button variant="secondary">Sign out</Button>
        <Button size="sm">Run agent</Button>
        <Button size="sm" variant="secondary">Approve</Button>
        <Button disabled>Disabled</Button>
      </Row>

      <Row title="Tabs">
        <Tabs
          tabs={[
            { id: "a", label: "Dashboard" },
            { id: "b", label: "Tasks" },
            { id: "c", label: "Jobs" },
          ]}
          activeId={tab}
          onSelect={setTab}
        />
      </Row>

      <Row title="StatCard / CardGrid">
        <div style={{ width: "100%" }}>
          <CardGrid>
            <StatCard label="Schedules" value={12} />
            <StatCard label="Recent jobs" value={7} />
            <StatCard label="Failed schedules" value={2} tone="fail" />
            <StatCard label="Healthy" value={10} tone="ok" />
          </CardGrid>
        </div>
      </Row>

      <Row title="Banner">
        <div style={{ width: "100%" }}>
          <Banner>Job running: schedule agent-manager-hourly (started 12:03)</Banner>
        </div>
      </Row>

      <Row title="Table">
        <div style={{ width: "100%" }}>
          <Table
            columns={[
              { key: "id", header: "ID", render: (r) => <code>{r.id}</code> },
              { key: "role", header: "Role", render: (r) => r.role },
              { key: "status", header: "Status", render: (r) => r.status },
              { key: "exit", header: "Exit", render: (r) => <StatusText exitCode={r.exit}>{r.exit}</StatusText> },
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            onRowClick={() => {}}
          />
        </div>
      </Row>

      <Row title="StatusText">
        <StatusText tone="ok">exit 0</StatusText>
        <StatusText tone="fail">exit 1</StatusText>
        <StatusText tone="neutral">running</StatusText>
      </Row>

      <Row title="Panel (inline form) + Field + inputs">
        <Panel inline>
          <Field label="Tier">
            <SelectInput
              value={sel}
              onChange={setSel}
              options={[
                { value: "service", label: "service" },
                { value: "infrastructure", label: "infrastructure" },
              ]}
            />
          </Field>
          <Field label="Arguments (after --)">
            <TextInput value={txt} onChange={setTxt} placeholder="--dry-run" />
          </Field>
          <Button type="button">Start job</Button>
        </Panel>
      </Row>

      <Row title="SearchInput">
        <SearchInput value={q} onChange={setQ} placeholder="Filter by id or name…" />
      </Row>

      <Row title="ListRow">
        <div style={{ width: "100%" }}>
          <ListRow left={<strong>schedule:agent-manager-hourly</strong>} right={<StatusText tone="ok">0</StatusText>} />
          <ListRow left={<strong>service/litellm/query</strong>} right={<StatusText tone="fail">1</StatusText>} />
        </div>
      </Row>

      <Row title="LogView">
        <div style={{ width: "100%" }}>
          <LogView>{"$ hdc run service litellm query --live\nOK health=200 models=3\nexit 0"}</LogView>
        </div>
      </Row>

      <Row title="Message">
        <Message>Guest-authoritative task queue.</Message>
        <Message tone="error">OIDC is not configured on this server.</Message>
      </Row>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Gallery />);
