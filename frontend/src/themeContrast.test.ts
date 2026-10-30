import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const css = readFileSync(
  new URL("./styles.css", import.meta.url),
  "utf8",
).replace(/\s+/g, "");
function tokens(selector: string) {
  const start = css.indexOf(selector + "{");
  if (start < 0) throw Error(`Missing theme ${selector}`);
  return Object.fromEntries(
    [
      ...css
        .slice(start, css.indexOf("}", start))
        .matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/g),
    ].map((m) => [m[1], m[2]]),
  );
}
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
describe("Theme text contrast and brand token coverage", () => {
  for (const theme of ["dark", "light"])
    for (const palette of ["plum", "teal", "blue"]) {
      const values = {
        ...tokens(':root,[data-theme="dark"]'),
        ...(theme === "light" ? tokens('[data-theme="light"]') : {}),
        ...(palette === "plum"
          ? {}
          : tokens(`[data-theme="${theme}"][data-palette="${palette}"]`)),
      };
      for (const [ink, bg] of [
        ["--color-ink", "--color-canvas"],
        ["--color-ink-muted", "--color-raised"],
        ["--color-accent", "--color-raised"],
        ["--color-on-accent", "--color-accent"],
      ])
        it(`${theme}/${palette} ${ink} on ${bg} meets WCAG AA`, () =>
          expect(contrast(values[ink], values[bg])).toBeGreaterThanOrEqual(
            4.5,
          ));
      it(`${theme}/${palette} has independent brand tokens`, () => {
        for (const token of [
          "--brand-primary",
          "--brand-secondary",
          "--brand-on",
        ])
          expect(values[token]).toMatch(/^#[\da-f]{6}$/);
      });
    }
  it("keeps code dark in both themes", () => {
    expect(tokens('[data-theme="light"]')["--code-fill"]).toBe("#0d1018");
    expect(tokens(':root,[data-theme="dark"]')["--code-fill"]).toBe("#0d1018");
  });
});
