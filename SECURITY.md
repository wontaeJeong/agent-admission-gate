# Security boundary

Agent Admission Gate inspects untrusted source packages. Its result is scoped to a source hash, profile, scanner revision and policy. It is not a sandbox certification, malware guarantee or replacement for isolation at runtime.

- HTTPS repositories only, exact administrator-configured host allowlist, public-address DNS validation, no URL credentials/query/fragment, no redirects, SSH/file protocols, submodules or LFS downloads. Enforce DNS/egress restrictions at the network layer as defense against DNS rebinding and scanner network access.
- Git credentials travel through child-process environment only; they are never written to job rows, argument lists, workspace files or logs. Scanner children get a clean environment, not application/cloud credentials.
- ZIP traversal, symlinks, special files, duplicate entries, encrypted archives, oversized input, extracted bytes, file counts, command output, execution time and clone disk usage are bounded. The source is never run or installed. Scanner processes are trusted parsers and must be patched/pinned; OS/container isolation remains necessary.
- Single process controls concurrency and cancellation; process groups are killed on timeout/cancel. Interrupted jobs fail after restart; no silent replay with lost credentials.
- API keys are high-entropy, hashed at rest, scoped, expiring and revocable. The original is emitted only at creation or successful device exchange. Device grants have high-entropy secrets, eight-character human codes, expiry, poll backoff, rate limits and atomic single-use exchange.
- Session cookies are HttpOnly/SameSite; mutating cookie requests require the configured Origin. stg/prod refuse non-HTTPS/local-auth configurations. OIDC uses PKCE, browser-bound single-use state, nonce, signature, issuer, audience and authorized-party checks.
- user/admin role and reviewer qualification are independent. Ownership is enforced for REST and MCP; API keys cannot enter interactive administrative/review/key-management routes. Self-approval is denied. Missing scanner coverage cannot be approved into ALLOW.
- Exceptions bind source + content SHA256 + finding fingerprint and expiry. Reviews retain original and effective verdicts separately. Revocation of an exception affects the next scan; previously issued verdicts are immutable records, not continuously valid authorizations.
- Markdown source is stored. React renders without raw HTML and suppresses external images; the optional server HTML representation is allowlist-sanitized. Internal/private posts and comments are filtered server-side. Feature flags are enforced before board routes.
- Public examples contain no private hostnames or real secrets. The API does not echo invalid request bodies. Application audit entries contain actions and reasons, not tokens or submitted source text.

## Deployment conditions

Keep one worker/replica, an explicit outbound firewall/proxy allowlist, restrictive container security and resource limits, HTTPS ingress, a supported PostgreSQL deployment, backups and a tested restore procedure. Full scans need the actual scanner tools, a current Grype database and a configured model. Model calls transmit normalized findings and package counts, not whole repositories; choose an approved provider for the data classification.

Use your organization's private disclosure channel for sensitive findings. Do not publish credentials or exploit data in public GitHub issues.

Production container access logging is disabled to avoid recording OIDC callback codes in query strings. Configure the ingress and identity provider to redact callback queries and authentication headers as well. The application audit records deliberately omit credentials and request bodies.
