/**
 * Standalone search box (type="search"), capped at 320px. Controlled. Use to
 * filter a list or {@link Table}.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 */
export function SearchInput({ value, onChange, placeholder = "Filter…" }) {
  return (
    <input
      className="search"
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
