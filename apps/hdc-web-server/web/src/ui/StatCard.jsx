/**
 * A single labelled metric (label above a large value). Wrap several in a
 * {@link CardGrid}. `tone` colours the value for pass/fail counts.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.label
 * @param {import("react").ReactNode} props.value
 * @param {"default"|"ok"|"fail"} [props.tone]
 */
export function StatCard({ label, value, tone = "default" }) {
  const valueCls = tone === "ok" ? "exit-ok" : tone === "fail" ? "exit-fail" : "";
  return (
    <div className="card">
      <span className="muted">{label}</span>
      <strong className={valueCls}>{value}</strong>
    </div>
  );
}
