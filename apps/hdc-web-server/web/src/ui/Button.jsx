/**
 * Primary action button. Use `variant="secondary"` for low-emphasis actions
 * and `size="sm"` for inline table/row actions.
 *
 * @param {object} props
 * @param {"primary"|"secondary"} [props.variant]
 * @param {"md"|"sm"} [props.size]
 * @param {"button"|"submit"} [props.type]
 * @param {boolean} [props.disabled]
 * @param {() => void} [props.onClick]
 * @param {import("react").ReactNode} props.children
 */
export function Button({ variant = "primary", size = "md", type = "button", disabled, onClick, children }) {
  const cls = [
    "btn",
    variant === "secondary" ? "btn-secondary" : "",
    size === "sm" ? "btn-sm" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
