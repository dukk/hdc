import { marked } from "marked";

/**
 * Convert markdown to HTML suitable for email clients (inline CSS, table styling).
 *
 * @param {string} markdown
 * @param {{ title?: string }} [opts]
 * @returns {string} full HTML document body wrapper
 */
export function markdownToHtmlEmail(markdown, opts = {}) {
  const title = typeof opts.title === "string" && opts.title.trim() ? opts.title.trim() : "HDC report";
  const body = marked.parse(String(markdown ?? ""), { gfm: true, breaks: false });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #222; max-width: 900px; margin: 0; padding: 16px; }
h1, h2, h3 { color: #111; margin-top: 1.2em; margin-bottom: 0.4em; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 14px; }
th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f4f4f4; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
pre { background: #f6f8fa; padding: 12px; overflow-x: auto; border-radius: 4px; }
ul, ol { padding-left: 1.4em; }
a { color: #0969da; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
