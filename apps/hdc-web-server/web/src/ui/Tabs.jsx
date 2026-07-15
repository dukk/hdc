/**
 * Horizontal tab bar. Controlled: the parent owns `activeId` and updates it
 * from `onSelect`.
 *
 * @param {object} props
 * @param {{ id: string, label: string }[]} props.tabs
 * @param {string} props.activeId
 * @param {(id: string) => void} props.onSelect
 */
export function Tabs({ tabs, activeId, onSelect }) {
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.id === activeId ? "tab active" : "tab"}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
