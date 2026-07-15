/**
 * Inline helper/error text. `tone="error"` for validation and failures,
 * `tone="muted"` for secondary hints.
 *
 * @param {object} props
 * @param {"muted"|"error"} [props.tone]
 * @param {import("react").ReactNode} props.children
 */
export function Message({ tone = "muted", children }) {
  return <p className={tone === "error" ? "error" : "muted"}>{children}</p>;
}
