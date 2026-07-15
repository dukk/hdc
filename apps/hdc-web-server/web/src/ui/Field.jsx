/**
 * Labelled form control. Wraps a {@link TextInput} or {@link SelectInput} (or
 * any control) with a label above it. Use inside a {@link Panel} `as="form"`.
 *
 * @param {object} props
 * @param {import("react").ReactNode} props.label
 * @param {import("react").ReactNode} props.children
 */
export function Field({ label, children }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}
