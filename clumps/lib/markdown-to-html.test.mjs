import { describe, expect, it } from "vitest";
import { markdownToHtmlEmail } from "./markdown-to-html.mjs";

describe("markdownToHtmlEmail", () => {
  it("renders headings and tables", () => {
    const md = `# Daily report

| Package | Status |
| --- | --- |
| bind | ok |

\`\`\`json
{"ok": true}
\`\`\`
`;
    const html = markdownToHtmlEmail(md, { title: "Test" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Daily report</h1>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Package</th>");
    expect(html).toContain("<td>bind</td>");
    expect(html).toContain("<pre>");
    expect(html).toContain("<title>Test</title>");
  });

  it("escapes title in head", () => {
    const html = markdownToHtmlEmail("x", { title: 'a<b>"c' });
    expect(html).toContain("<title>a&lt;b&gt;&quot;c</title>");
  });
});
