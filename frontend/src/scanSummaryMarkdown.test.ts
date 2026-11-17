import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { Markdown } from "./components";

it("renders actual server summary strings as text with only the canonical scan link active", () => {
  const root = resolve(import.meta.dirname, "../..");
  // CI's web job prepares the project Python environment before frontend checks.
  const markdown = execFileSync(
    resolve(root, ".venv/bin/python"),
    [
      "-c",
      `
from aag.scan_summary import build_scan_summary
strings = [
    '<img src=x> [click](javascript:alert(1)) https://evil.test www.evil.test user@evil.test',
    '\x60 \x60\x60 \x60\x60\x60 [link](https://evil.test)\\n# injected heading',
    '   https://evil.test   ',
]
job = dict(id='synthetic',source='package.zip',created_at=0,findings=[dict(severity='high',engine='builtin',rule='example',title=title,path='a.py',line=1) for title in strings])
print(build_scan_summary(job,public_url='https://gate.example'))
`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  const html = renderToStaticMarkup(
    createElement(Markdown, { children: markdown }),
  );
  expect(html.match(/<a /g) || []).toHaveLength(1);
  expect(html).toContain('href="https://gate.example/jobs/synthetic"');
  expect(html).not.toContain("<img");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="https://evil');
  expect(html).not.toContain('href="mailto:');
  expect(html).not.toContain("<h1>injected heading</h1>");
  expect(html).toContain("&lt;img src=x&gt;");
});
