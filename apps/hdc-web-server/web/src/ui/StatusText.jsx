/**
 * Colour-coded status/exit text. Pass an explicit `tone`, or an `exitCode`
 * (0 → ok, non-zero → fail, null/undefined → neutral).
 *
 * @param {object} props
 * @param {"ok"|"fail"|"neutral"} [props.tone]
 * @param {number|null} [props.exitCode]
 * @param {import("react").ReactNode} props.children
 */
export function StatusText({ tone, exitCode, children }) {
  const resolved =
    tone ?? (exitCode === 0 ? "ok" : exitCode == null ? "neutral" : "fail");
  const cls = resolved === "ok" ? "exit-ok" : resolved === "fail" ? "exit-fail" : "";
  return <span className={cls}>{children}</span>;
}
