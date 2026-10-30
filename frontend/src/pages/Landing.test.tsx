import { expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Landing } from "./Landing";
import { coverageItems } from "./Coverage";
test("public landing uses login and explicitly states assurance boundary",()=>{
 const html=renderToStaticMarkup(<MemoryRouter><Landing mode="oidc"/></MemoryRouter>);
 expect(html).toContain("자동 ALLOW는 안전성 보증이 아닙니다");
 expect(html).toContain('href="/login"');
 expect(html).toContain("사내 SSO로 시작");
});
test("coverage distinguishes implementation evidence and site acceptance",()=>{
 expect(coverageItems.length).toBeGreaterThan(9);
 expect(coverageItems.every(r=>r.evidence.length>4&&r.acceptance.length>7)).toBe(true);
});
