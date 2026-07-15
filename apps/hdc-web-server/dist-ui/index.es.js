// web/src/ui/Button.jsx
import { jsx } from "react/jsx-runtime";
function Button({ variant = "primary", size = "md", type = "button", disabled, onClick, children }) {
  const cls = [
    "btn",
    variant === "secondary" ? "btn-secondary" : "",
    size === "sm" ? "btn-sm" : ""
  ].filter(Boolean).join(" ");
  return /* @__PURE__ */ jsx("button", { type, className: cls, disabled, onClick, children });
}

// web/src/ui/Tabs.jsx
import { jsx as jsx2 } from "react/jsx-runtime";
function Tabs({ tabs, activeId, onSelect }) {
  return /* @__PURE__ */ jsx2("nav", { className: "tabs", children: tabs.map((t) => /* @__PURE__ */ jsx2(
    "button",
    {
      type: "button",
      className: t.id === activeId ? "tab active" : "tab",
      onClick: () => onSelect(t.id),
      children: t.label
    },
    t.id
  )) });
}

// web/src/ui/StatCard.jsx
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
function StatCard({ label, value, tone = "default" }) {
  const valueCls = tone === "ok" ? "exit-ok" : tone === "fail" ? "exit-fail" : "";
  return /* @__PURE__ */ jsxs("div", { className: "card", children: [
    /* @__PURE__ */ jsx3("span", { className: "muted", children: label }),
    /* @__PURE__ */ jsx3("strong", { className: valueCls, children: value })
  ] });
}

// web/src/ui/CardGrid.jsx
import { jsx as jsx4 } from "react/jsx-runtime";
function CardGrid({ children }) {
  return /* @__PURE__ */ jsx4("div", { className: "cards", children });
}

// web/src/ui/Banner.jsx
import { jsx as jsx5 } from "react/jsx-runtime";
function Banner({ children }) {
  return /* @__PURE__ */ jsx5("div", { className: "banner", children });
}

// web/src/ui/Table.jsx
import { jsx as jsx6, jsxs as jsxs2 } from "react/jsx-runtime";
function Table({ columns, rows, rowKey, onRowClick }) {
  return /* @__PURE__ */ jsx6("div", { className: "table-wrap", children: /* @__PURE__ */ jsxs2("table", { className: "table", children: [
    /* @__PURE__ */ jsx6("thead", { children: /* @__PURE__ */ jsx6("tr", { children: columns.map((c) => /* @__PURE__ */ jsx6("th", { children: c.header }, c.key)) }) }),
    /* @__PURE__ */ jsx6("tbody", { children: rows.map((row) => /* @__PURE__ */ jsx6(
      "tr",
      {
        className: onRowClick ? "clickable" : void 0,
        onClick: onRowClick ? () => onRowClick(row) : void 0,
        children: columns.map((c) => /* @__PURE__ */ jsx6("td", { children: c.render(row) }, c.key))
      },
      rowKey(row)
    )) })
  ] }) });
}

// web/src/ui/LogView.jsx
import { jsx as jsx7 } from "react/jsx-runtime";
function LogView({ children }) {
  return /* @__PURE__ */ jsx7("pre", { className: "log", children });
}

// web/src/ui/StatusText.jsx
import { jsx as jsx8 } from "react/jsx-runtime";
function StatusText({ tone, exitCode, children }) {
  const resolved = tone ?? (exitCode === 0 ? "ok" : exitCode == null ? "neutral" : "fail");
  const cls = resolved === "ok" ? "exit-ok" : resolved === "fail" ? "exit-fail" : "";
  return /* @__PURE__ */ jsx8("span", { className: cls, children });
}

// web/src/ui/Panel.jsx
import { jsx as jsx9 } from "react/jsx-runtime";
function Panel({ inline = false, as = "div", onSubmit, children }) {
  const cls = inline ? "panel inline" : "panel";
  if (as === "form") {
    return /* @__PURE__ */ jsx9("form", { className: cls, onSubmit, children });
  }
  return /* @__PURE__ */ jsx9("div", { className: cls, children });
}

// web/src/ui/Field.jsx
import { jsxs as jsxs3 } from "react/jsx-runtime";
function Field({ label, children }) {
  return /* @__PURE__ */ jsxs3("label", { className: "field", children: [
    label,
    children
  ] });
}

// web/src/ui/TextInput.jsx
import { jsx as jsx10 } from "react/jsx-runtime";
function TextInput({ value, onChange, placeholder, type = "text", required }) {
  return /* @__PURE__ */ jsx10(
    "input",
    {
      className: "input",
      type,
      value,
      placeholder,
      required,
      onChange: (e) => onChange(e.target.value)
    }
  );
}

// web/src/ui/SelectInput.jsx
import { jsx as jsx11 } from "react/jsx-runtime";
function SelectInput({ value, onChange, options, required }) {
  return /* @__PURE__ */ jsx11(
    "select",
    {
      className: "input",
      value,
      required,
      onChange: (e) => onChange(e.target.value),
      children: options.map((o) => /* @__PURE__ */ jsx11("option", { value: o.value, children: o.label }, o.value))
    }
  );
}

// web/src/ui/SearchInput.jsx
import { jsx as jsx12 } from "react/jsx-runtime";
function SearchInput({ value, onChange, placeholder = "Filter\u2026" }) {
  return /* @__PURE__ */ jsx12(
    "input",
    {
      className: "search",
      type: "search",
      value,
      placeholder,
      onChange: (e) => onChange(e.target.value)
    }
  );
}

// web/src/ui/Message.jsx
import { jsx as jsx13 } from "react/jsx-runtime";
function Message({ tone = "muted", children }) {
  return /* @__PURE__ */ jsx13("p", { className: tone === "error" ? "error" : "muted", children });
}

// web/src/ui/ListRow.jsx
import { jsx as jsx14, jsxs as jsxs4 } from "react/jsx-runtime";
function ListRow({ left, right, onClick }) {
  return /* @__PURE__ */ jsxs4("div", { className: "list-row", onClick, children: [
    /* @__PURE__ */ jsx14("span", { children: left }),
    /* @__PURE__ */ jsx14("span", { children: right })
  ] });
}

// web/src/ui/Spinner.jsx
import { jsx as jsx15 } from "react/jsx-runtime";
function Spinner({ children = "Loading\u2026" }) {
  return /* @__PURE__ */ jsx15("div", { className: "loading", children });
}
export {
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
  TextInput
};
