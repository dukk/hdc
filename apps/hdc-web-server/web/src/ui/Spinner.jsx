/**
 * Lightweight loading placeholder (muted text). Shown while first data or the
 * auth check is in flight.
 *
 * @param {object} props
 * @param {import("react").ReactNode} [props.children]
 */
export function Spinner({ children = "Loading…" }) {
  return <div className="loading">{children}</div>;
}
