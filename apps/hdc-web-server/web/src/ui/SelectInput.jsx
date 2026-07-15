/**
 * Full-width dropdown, styled to match {@link TextInput}. Controlled; options
 * are `{ value, label }` pairs.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {{ value: string, label: import("react").ReactNode }[]} props.options
 * @param {boolean} [props.required]
 */
export function SelectInput({ value, onChange, options, required }) {
  return (
    <select
      className="input"
      value={value}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
