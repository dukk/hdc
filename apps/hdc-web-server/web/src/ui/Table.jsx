/**
 * Data table with a horizontal-scroll wrapper. Columns declare a header and a
 * cell renderer; rows are opaque objects keyed by `rowKey`. Pass `onRowClick`
 * to make rows clickable (adds hover + pointer affordance).
 *
 * @template T
 * @param {object} props
 * @param {{ key: string, header: import("react").ReactNode, render: (row: T) => import("react").ReactNode }[]} props.columns
 * @param {T[]} props.rows
 * @param {(row: T) => string} props.rowKey
 * @param {(row: T) => void} [props.onRowClick]
 */
export function Table({ columns, rows, rowKey, onRowClick }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? "clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
