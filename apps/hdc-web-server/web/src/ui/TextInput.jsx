/**
 * Single-line text input, full-width within its {@link Field}. Controlled.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.placeholder]
 * @param {string} [props.type]
 * @param {boolean} [props.required]
 * @param {boolean} [props.disabled]
 */
export function TextInput({ value, onChange, placeholder, type = "text", required, disabled }) {
  return (
    <input
      className="input"
      type={type}
      value={value}
      placeholder={placeholder}
      required={required}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
