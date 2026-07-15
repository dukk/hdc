/**
 * Bordered surface container. Default is a centered card (login / empty
 * states); `inline` left-aligns it for use inside a section (e.g. a form or a
 * detail pane). Render as a `<form>` by passing `as="form"` with `onSubmit`.
 *
 * @param {object} props
 * @param {boolean} [props.inline]
 * @param {"div"|"form"} [props.as]
 * @param {(e: import("react").FormEvent) => void} [props.onSubmit]
 * @param {import("react").ReactNode} props.children
 */
export function Panel({ inline = false, as = "div", onSubmit, children }) {
  const cls = inline ? "panel inline" : "panel";
  if (as === "form") {
    return (
      <form className={cls} onSubmit={onSubmit}>
        {children}
      </form>
    );
  }
  return <div className={cls}>{children}</div>;
}
