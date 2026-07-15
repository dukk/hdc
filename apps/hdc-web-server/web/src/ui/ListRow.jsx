/**
 * Clickable row with left content and a right-aligned status/value — used for
 * job lists. Rows stack with dividers; the whole row is the click target.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.left
 * @param {import("react").ReactNode} props.right
 * @param {() => void} [props.onClick]
 */
export function ListRow({ left, right, onClick }) {
  return (
    <div className="list-row" onClick={onClick}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}
