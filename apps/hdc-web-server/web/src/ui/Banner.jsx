/**
 * Prominent inline notice — e.g. "a job is currently running". Warning-toned.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.children
 */
export function Banner({ children }) {
  return <div className="banner">{children}</div>;
}
