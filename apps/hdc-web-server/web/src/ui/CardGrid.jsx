/**
 * Responsive grid for {@link StatCard}s (auto-fills columns at min 180px).
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 */
export function CardGrid({ children }) {
  return <div className="cards">{children}</div>;
}
