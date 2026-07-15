/**
 * Monospace, scrollable block for command logs and JSON detail. Preserves
 * whitespace and wraps long lines; caps at ~400px tall.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 */
export function LogView({ children }) {
  return <pre className="log">{children}</pre>;
}
