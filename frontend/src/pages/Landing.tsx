import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, GitBranch, ScanSearch, ShieldAlert } from "lucide-react";
import { Brand } from "../Brand";
import "./landing.css";
/** Static, unauthenticated product explanation. No fictional results. */
export function Landing({mode, authenticated=false}: {mode:string; authenticated?:boolean}) {
 return <div className="gate-landing">
  <a className="skip-link" href="#gate-main">본문으로 이동</a>
  <header className="gate-landing-head">
   <Link to="/" aria-label="Agent Admission Gate 홈"><Brand /></Link>
   <nav aria-label="서비스 소개"><a href="#process">검사 절차</a><a href="#limits">보안 경계</a></nav>
   <Link className="primary" to={authenticated?"/":"/login"}>{authenticated?"대시보드":"로그인"} <ArrowRight size={16}/></Link>
  </header>
  <main id="gate-main" tabIndex={-1}>
   <section className="gate-hero">
    <p className="eyebrow">EVIDENCE BEFORE ADMISSION</p>
    <h1>에이전트를 연결하기 전에,<br/><em>위험과 근거</em>를 확인합니다.</h1>
    <p className="gate-lead">Git 저장소와 ZIP 패키지의 보안·의존성·라이선스 위험을 검사하고 자동 판정의 한계, 사람의 검토, 감사 기록을 함께 관리합니다.</p>
    <div className="gate-actions"><Link className="primary" to={authenticated?"/new":"/login"}>{authenticated?"새 검사 실행":mode==="oidc"?"사내 SSO로 시작":"로그인 후 시작"} <ArrowRight size={17}/></Link><a href="#process">작동 방식</a></div>
    <p className="gate-warning"><ShieldAlert size={19}/> 자동 ALLOW는 안전성 보증이 아닙니다. 근거 부족과 필수 엔진 실패는 검토 대상으로 남습니다.</p>
   </section>
   <section className="gate-landing-section" id="process">
    <p className="eyebrow">INSPECT → REVIEW → CONNECT</p><h2>반입까지 이어지는 세 단계</h2>
    <div className="gate-steps">
     <article><ScanSearch size={25}/><small>01 / INSPECT</small><h3>소스·의존성 검사</h3><p>정적 규칙, SBOM, 취약점·라이선스 정보와 엔진 누락 여부를 기록합니다.</p></article>
     <article><ClipboardCheck size={25}/><small>02 / REVIEW</small><h3>근거에 기반한 검토</h3><p>ALLOW/REVIEW/BLOCK 원판정과 최종판정, 사람의 사유와 감사 이력을 구분합니다.</p></article>
     <article><GitBranch size={25}/><small>03 / CONNECT</small><h3>지속 가능한 연동</h3><p>REST, MCP, CLI와 범위가 제한된 API 키로 동일한 정책을 적용합니다.</p></article>
    </div>
   </section>
   <section className="gate-landing-section" id="limits"><p className="eyebrow">WHY ADMISSION GATE</p><h2>검사 결과에서 반입 의사결정까지</h2>
    <div className="gate-compare"><article><h3>개별 검사기</h3><p>위험 발견과 실행 결과를 각각 확인합니다.</p></article><article className="gate-focus"><h3>Agent Admission Gate</h3><p>검사 범위·판정 근거·승인 책임·예외 만료·조치 정보를 하나의 흐름으로 관리합니다.</p></article></div>
    <p>업로드한 코드를 실행하거나 임의 MCP 서버에 접속하지 않습니다. 사내 SSO와 실제 엔진·모델·네트워크는 별도 운영 검증이 필요합니다.</p>
   </section>
  </main><footer className="gate-landing-footer"><Brand compact/><span>Agent Admission Gate · Evidence-first security review</span><Link to={authenticated?"/guide":"/login"}>연동 가이드</Link></footer>
 </div>;
}
