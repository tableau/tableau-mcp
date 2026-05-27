---
sidebar_position: 5
title: Manual E2E Validation Plan — Admin Tools
---

# Tableau MCP for Admins — Manual E2E Validation Plan

This document is the manual end-to-end validation plan for the
[**Tableau MCP for Admins**](https://gus.lightning.force.com/lightning/r/ADM_Epic__c/a3QEE000002AWIP2A4/view)
epic. It is the deliverable for **W-22551544** and serves as the running test record
across the three Jobs To Be Done (JTBDs) the epic covers:

1. Stale Content Cleanup (P1)
2. Extract Refresh Schedule Optimization (P2)
3. User License Reclamation (P3)

The doc lives in the repo so it stays version-controlled alongside the code it tests; it
is also intended to be mirrored into a Google Doc for cross-team consumption.

> **Audience:** Tableau MCP engineers, QA, PM, and the Customer Zero pilot team.

---

## 1. Overview

### 1.1 Purpose

End-to-end validation of the admin-tools surface added under epic 264 against a real
Tableau Cloud site, covering correctness, security, scale, performance, and quality
thresholds defined in the PRD.

### 1.2 In scope

- All admin tools and prompts shipped under the epic, gated behind
  `ADMIN_TOOLS_ENABLED`.
- All three JTBDs, both Inform (P1) and Apply (P2 / P3) phases.
- Functional, negative, adversarial, and performance test cases.
- A required + optional AI-client matrix.

### 1.3 Out of scope

- Tableau Server (no Admin Insights). Cloud only.
- Apply phases for any JTBD whose Apply WIs have not yet shipped — those rows are
  placeholders and marked `BLOCKED on <WI>`.

### 1.4 JTBD → driving WIs → MCP surface

| JTBD | Phase | Driving WIs | MCP surface |
|---|---|---|---|
| Stale Content Cleanup | Inform (P1) | W-22551291, W-22551323, W-22551424, W-22551007 | `query-admin-insights-ts-events`, `query-admin-insights-site-content`, `get-stale-content-report`, `stale-content-cleanup-inform` prompt |
| Stale Content Cleanup | Apply (P2) | _TBD_ | `add-tags-to-*`, `delete-workbook`, `delete-datasource`, `stale-content-cleanup-apply` prompt |
| Extract Refresh Optimization | Inform (P1) | W-21971012 + future | `list-extract-refresh-tasks`, `list-schedules`, `query-admin-insights-job-performance`, `extract-optimization-inform` prompt |
| Extract Refresh Optimization | Apply (P2) | _TBD_ | `delete-extract-refresh-task`, `update-cloud-extract-refresh-task`, `extract-optimization-apply` prompt |
| User License Reclamation | Inform (P3) | _TBD_ | `list-users`, `get-user`, `list-groups`, `query-admin-insights-ts-users`, `user-license-reclamation-inform` prompt |
| User License Reclamation | Apply (P3) | _TBD_ | `update-user`, `delete-user`, `update-*-owner`, `user-license-reclamation-apply` prompt |

Cross-cutting WIs: W-22444374 (`list-projects`), W-22585763 (dev setup).

### 1.5 PRD success-criteria thresholds

| Metric | Target |
|---|---|
| Tool Call Accuracy | ≥ 90% |
| Faithfulness Score | ≥ 0.95 |
| Task Success Rate | ≥ 70% |
| Single tool call (P95, scaled site) | < 1 minute |
| Full Inform prompt run (scaled site) | < 10 minutes |
| Speedup vs. manual workflow | ≥ 2× |
| User Acceptance Rate (UAT) | ≥ 30% |

### 1.6 Reference documents

- PRD: [Tableau MCP for Admins — PRD](https://docs.google.com/document/d/1BIhQBq8sSRdQOzlLcQZn0S1pR4lHcJi8Q5HE9sQatcs/edit)
- Plan doc: [Tableau MCP for Admins — Plan (264)](https://docs.google.com/document/d/148av48p_nM8VDk8awRh49CmkhLI23gYsGZODxlR-SGc/edit)
- JTBD work breakdown: [Per-JTBD Work Breakdown (Tools & Prompts)](https://docs.google.com/document/d/1DMp-4P5ighq027IjA9iBBWLE_6TEEdjW_P1X1dMzVKs/edit)
- Stale content research: [Tableau Cloud Stale Content Detection](https://docs.google.com/document/d/1M019mY3GWh3qaLoEtZznTxaYdi-G-Z2JWpTUk285bqo/edit)
- GUS epic: [264 STRETCH GA Tableau MCP for Admins](https://gus.lightning.force.com/lightning/r/ADM_Epic__c/a3QEE000002AWIP2A4/view)

---

## 2. Test environment setup

### 2.1 Cloud site requirements

- Tableau Cloud (not Server).
- Admin Insights enabled. Confirm by browsing to the site's `Admin Insights` project and
  inspecting the published datasources `TS Events`, `TS Users`, `Site Content`,
  `Job Performance`, `Permissions`, `Subscriptions`, etc.
- VizQL Data Service (VDS) available. Confirm with `POST /api/v1/vizql-data-service/simple-request`.
- ≥ 1 Site Administrator Creator (for the admin-runner).
- ≥ 3 non-admin accounts with site roles spanning `Viewer`, `Explorer`, `Creator` for
  rejection-path tests.

### 2.2 Site provisioning

The team does **not** have a dedicated scaled Customer Zero site today. Two paths to a
working test environment:

**Primary — UWC Canary**
- Reach out to Joe C / Harveen to schedule TMCP onto UWC Canary.
- TMCP rollout in flight across dev/test/stage/prod cells.
- Pros: real production-shape data, live Admin Insights pipeline.
- Cons: shared with other testers; rate limits apply; cannot freely seed content.

**Fallback — Heroku + Tableau Cloud trial**
- Deploy TMCP to Heroku per [Deploy on Heroku](./deploy-heroku.md).
- Pair with a Tableau Cloud trial / dev site.
- Pros: full control over content seeding (Section 2.3).
- Cons: no real production traffic; need to wait ≥ 24h after seeding for Admin Insights
  to populate `Last Accessed At` / `TS Events` data.

**Workaround for VDS-only smoke (no Admin Insights enabled on the site)**

Publish a custom datasource named `TS Events` / `Site Content` matching the documented
schema (see Section 7). Lets you exercise the VDS query path without provisioning Admin
Insights. Limitation: the data is static and you must hand-seed access events.

**Action items (record once confirmed):**

| Item | Value |
|---|---|
| Test site URL | _TBD_ |
| Site name | _TBD_ |
| Admin runner email | _TBD_ |
| Tableau Cloud version | _TBD_ |
| Admin Insights pod | _TBD_ |
| TMCP deployment URL | _TBD_ |

### 2.3 Content seeding to reach PRD scale

PRD targets: **1k+ users · 1k+ datasources · 10k+ workbooks · ≥ 50 projects**.

Seeding scripts live under `tests/scripts/seed-cloud-site/` (separate from the production
package). Each is idempotent and resumable; emits an entry to `seed-manifest.json` so
test cases can reference exact LUIDs.

| Script | Purpose | Notes |
|---|---|---|
| `seed-projects.ts` | Create 50 projects, mix top-level + nested | Uses REST `POST /sites/{siteId}/projects` |
| `seed-users.ts` | Create 1k users | Mix: 10% admin, 30% Creator, 40% Explorer, 20% Viewer. Include never-logged-in users for license-reclamation fixtures. |
| `seed-datasources.ts` | Publish 1k datasources via [TSC](https://tableau.github.io/server-client-python/) | 20% extracts with refresh schedules, 50% live, 30% no connection |
| `seed-workbooks.ts` | Publish 10k workbooks via TSC | Vary owners across seeded users |
| `seed-access-patterns.ts` | Generate access events on a subset | ~30% items get accessed at varying ages so `Last Accessed At` is populated; ~70% remain `null` |
| `seed-extracts.ts` | Schedule extract refreshes on the 200 extract datasources | Mix: hourly / daily / weekly |

After seeding, allow **24 hours** for Admin Insights to refresh, then verify with:

```bash
# Verify row counts via the raw query tool
mcp call query-admin-insights-site-content '{"query": {"fields": [{"fieldCaption": "Item ID"}]}}'
```

### 2.4 User + role + group fixtures

Document specific test users by purpose (record after seeding):

| Purpose | Email | Site role | Last login | Owned content |
|---|---|---|---|---|
| Admin runner | `admin-runner@<site>` | SiteAdministratorCreator | recent | none |
| Inactive license candidate | `inactive-1@<site>` | Creator | > 180d ago | 5 WB |
| Active Creator | `active-creator@<site>` | Creator | < 7d ago | 20 WB |
| Non-admin (rejection target) | `viewer-1@<site>` | Viewer | recent | none |
| Apply-phase target | `to-be-revoked@<site>` | Explorer | > 90d ago | 3 WB |

Groups: at least 3 groups for `INCLUDE_GROUP_IDS` filter testing (license reclamation
JTBD).

### 2.5 TMCP server setup

**Build + deploy**

```bash
# Local
npm ci
npm run build
ADMIN_TOOLS_ENABLED=true npm run start:web

# Heroku
heroku config:set ADMIN_TOOLS_ENABLED=true STALE_CONTENT_MIN_AGE_DAYS=90 --app <app>
git push heroku main
```

**Required env vars (admin-tools surface)**

| Var | Sample | Notes |
|---|---|---|
| `ADMIN_TOOLS_ENABLED` | `true` | Off by default. Restart required to take effect. |
| `STALE_CONTENT_MIN_AGE_DAYS` | `90` | 1–3650. Default 90. |
| `INCLUDE_PROJECT_IDS` | `<luid>,<luid>` | Optional bound; reused by report tools. |
| `MAX_RESULT_LIMITS` | `get-stale-content-report:1000` | Per-tool row caps. |
| `OAUTH_*` | per [oauth docs](../configuration/mcp-config) | Required for OAuth flow. |

**OAuth wiring**

- Register a Tableau Connected App with the required API scopes.
- Verify token issuance: `curl -X POST <issuer>/oauth2/token`.
- Verify scope advertisement: `GET /.well-known/oauth-authorization-server`.

**Server health checks**

```bash
curl http://localhost:3927/health
# Expect: 200 OK

curl http://localhost:3927/mcp -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expect: tool list includes 3 admin tools when flag is true
```

### 2.6 AI client matrix

**Required (gating GA)**

| Client | Role | Connection notes |
|---|---|---|
| **mcpJam** | Primary dev-loop client. All test cases run here first. | `npx @mcpjam/inspector`; configure HTTP transport pointing at TMCP. |
| **Claude Desktop** | Flagship Anthropic client. Native MCP support, OAuth flow. | `~/Library/Application Support/Claude/claude_desktop_config.json` MCP entry. |
| **Claude Code** | CLI-driven; tests both stdio and HTTP transports. | `claude mcp add tableau-mcp ...`. |

**Optional (post-GA UX validation)**

| Client | Role |
|---|---|
| Goose | Open-source; alternative tool-rendering. |
| ChatGPT | Non-Anthropic; validates SDK portability. |
| Cursor | IDE-integrated; validates prompt UX in editor context. |

For each Required client, record:
- Connection config snippet
- Tool list visible (admin tools + non-admin)
- Screenshot of one successful tool invocation
- Known quirks

---

## 3. Test case checklist

Format: `Pass`/`Fail`/`Blocked` in the checkbox column. `Notes` records actual values
seen, links to issues opened in `tmcp-admin-tools-testing-issues.md`, etc.

Conventions:

- Run each test against the **scaled** site (Section 2.3) unless noted otherwise.
- Run as the **admin runner** unless the test specifies a different user.
- Cycle date stamp: append a new column per test cycle (e.g. `2026-05-20`).

### 3.1 JTBD #1 — Stale Content Cleanup

**3.1.1 Inform tests** (W-22551291, W-22551323, W-22551424, related)

| # | Test | Pre-conditions | Expected | Cycle 1 |
|---|---|---|---|---|
| 1.1 | Default invocation of `stale-content-cleanup-inform` | Seeded site, threshold 90 | Returns Markdown table; no Admin Insights items; `totalStaleItems` matches expected count from manifest | ☐ |
| 1.2 | `get-stale-content-report` with `minAgeDays: 30` | — | More rows than default | ☐ |
| 1.3 | `get-stale-content-report` with `minAgeDays: 365` | — | Fewer rows than default | ☐ |
| 1.4 | `get-stale-content-report` with `projectIds` set to 2 seeded project LUIDs | — | All result rows have `project` ∈ those 2 names | ☐ |
| 1.5 | `get-stale-content-report` with `itemTypes: ["Workbook"]` | — | No `Datasource` rows | ☐ |
| 1.6 | `get-stale-content-report` with non-existent project LUID | — | Empty `rows` array, no error | ☐ |
| 1.7 | Threshold edge case: item with exactly N days stale, threshold N | Pick a seeded item with known age | Excluded (strict `>`) | ☐ |
| 1.8 | Never-accessed item | Pick item with `Last Accessed At = null` | Appears with `neverAccessed: true`, `lastUsedDate = createdAt` | ☐ |
| 1.9 | Recently accessed item | Pick item accessed within 1d | Excluded | ☐ |
| 1.10 | Admin Insights project items | — | Always excluded regardless of threshold | ☐ |
| 1.11 | Sort order | Result with ≥ 5 items | Verify desc by `daysSinceLastUse`, tiebreak by `size` | ☐ |
| 1.12 | `query-admin-insights-site-content` raw query returning AI items | — | AI items appear (raw tool unfiltered) | ☐ |
| 1.13 | `query-admin-insights-ts-events` raw query | — | Returns rows; field caption `Item Id` (Title Case) valid | ☐ |
| 1.14 | LUID-to-name resolution cache | Two consecutive calls with `projectIds` | Only 1× `list-projects` REST call (log inspect) | ☐ |
| 1.15 | `INCLUDE_PROJECT_IDS` env-bound + arg `projectIds`: intersection | Set both; arg includes one ID outside env bound | Result rows only in intersection | ☐ |

**3.1.2 Apply tests** — `BLOCKED on 2B WIs`

| # | Test | Expected | Cycle 1 |
|---|---|---|---|
| 1.A.1 | Tag stale items as `Stale Content` | Tags applied; subsequent inform run shows tag | Blocked |
| 1.A.2 | Delete a stale workbook | Item moved to Recycle Bin; recoverable for 30d | Blocked |
| 1.A.3 | HITL break before delete | Prompt pauses; user must confirm | Blocked |
| 1.A.4 | Adversarial tag name (prompt injection) | Rejected by Zod allowlist | Blocked |

### 3.2 JTBD #2 — Extract Refresh Optimization

Placeholder. Full table to be populated when WIs land. Expected coverage:

- `list-extract-refresh-tasks` correctness
- `list-schedules` correctness
- `query-admin-insights-job-performance` returns job records
- Inform prompt produces per-task recommendations (downgrade / disable / move-window)
- Apply prompt updates / deletes refresh tasks with HITL break

### 3.3 JTBD #3 — User License Reclamation

Placeholder. Full table to be populated when WIs land. Expected coverage:

- `list-users` filter by site role + last-login
- `list-groups` and `list-users-in-group`
- `query-admin-insights-ts-users` correctness
- Inform prompt produces revocation candidate list with owned-content count
- Apply prompt downgrades / deletes users + transfers content

### 3.4 Cross-cutting

| # | Test | Expected | Cycle 1 |
|---|---|---|---|
| C.1 | `ADMIN_TOOLS_ENABLED=false` (default) | Admin tools not in tool list; prompt not registered | ☐ |
| C.2 | `ADMIN_TOOLS_ENABLED=true`, non-admin caller | Tools visible but each call returns `AdminOnlyError` (403) | ☐ |
| C.3 | `ADMIN_TOOLS_ENABLED=true`, admin caller | Tools work normally | ☐ |
| C.4 | OAuth scope missing for an admin tool | Tool call fails with 401/403; `WWW-Authenticate` hints required scope | ☐ |
| C.5 | Tableau Server (not Cloud) | Admin tools either disabled or report Admin Insights unavailable cleanly | ☐ |
| C.6 | Admin Insights datasource missing on site | `AdminInsightsUnavailableError` (404) with actionable message | ☐ |
| C.7 | adminGate cache TTL (5 min) | Repeated calls within window ⇒ no extra `getUser` REST (log inspect) | ☐ |
| C.8 | Bypass of `resourceAccessChecker` | Admin tools succeed even when `INCLUDE_DATASOURCE_IDS` doesn't include AI LUIDs | ☐ |
| C.9 | Feature flag flip (live → off → on) | Restart required to take effect | ☐ |

### 3.5 Negative + adversarial

| # | Test | Expected | Cycle 1 |
|---|---|---|---|
| N.1 | `minAgeDays: 0` | Zod rejects (min 1) | ☐ |
| N.2 | `minAgeDays: 5000` | Zod rejects (max 3650) | ☐ |
| N.3 | `projectIds: []` (empty) | Treated as no scope; full universe | ☐ |
| N.4 | `itemTypes: ["Flow"]` | Zod rejects (enum `Workbook` \| `Datasource` only) | ☐ |
| N.5 | Prompt input with embedded "ignore previous instructions" | Tool params validated by Zod; injection contained | ☐ |
| N.6 | Project LUID that is not a UUID format | REST list-projects either returns empty or errors cleanly | ☐ |
| N.7 | Server in middle of token refresh | Admin tools succeed (test happy path under refresh) | ☐ |
| N.8 | VDS rate limit hit | Tool surfaces specific error; subsequent retry works | ☐ |

### 3.6 Per-client smoke

For each Required client (mcpJam, Claude Desktop, Claude Code), run a 5-test smoke:

| # | Test | Expected |
|---|---|---|
| S.1 | Connect to TMCP | Connection succeeds; OAuth flow completes if configured |
| S.2 | List tools | Admin tools visible (when flag is on); non-admin tools also visible |
| S.3 | Invoke `get-stale-content-report` (defaults) | JSON result rendered |
| S.4 | Invoke `stale-content-cleanup-inform` prompt | Markdown table rendered to user |
| S.5 | Capture screenshot | Saved alongside this doc / linked from cycle log |

---

## 4. Performance testing

### 4.1 PRD NFR targets recap

- Single tool call: **< 1 minute** on the 1k/1k/10k site.
- Full Inform prompt run: **< 10 minutes** on same site.
- Tool Call Accuracy ≥ 90%, Faithfulness ≥ 0.95, Task Success ≥ 70%, ≥ 2× speedup vs.
  manual.

### 4.2 Per-tool latency budgets

Target table (P50 / P95). Measure each tool 30× via mcpJam logger or a driver script
under `tests/scripts/perf/`. Latency captured server-side via
`productTelemetryForwarder.send('tool_call', ...)` records.

| Tool | P50 budget | P95 budget | Notes |
|---|---|---|---|
| `query-admin-insights-site-content` | 5s | 20s | VDS query against 10k+ rows |
| `query-admin-insights-ts-events` | 5s | 20s | 90d window |
| `get-stale-content-report` (no scope) | 8s | 30s | One VDS call + LUID resolver if needed |
| `get-stale-content-report` (scoped, cached) | 6s | 20s | Skips list-projects REST |
| `list-projects` (1k+ projects) | 3s | 10s | Paginated |
| `adminGate.assertAdmin` (cold) | 1s | 3s | Single REST call |
| `adminGate.assertAdmin` (cached) | < 10ms | < 50ms | In-memory map lookup |

### 4.3 End-to-end prompt-run timing

| Run type | Target | Cycle 1 |
|---|---|---|
| Cold (fresh server, empty caches) | < 10 min | _TBD_ |
| Warm (post-cache) | < 5 min | _TBD_ |

Drive via Claude Code or Claude Desktop with a deterministic prompt
(`/stale-content-cleanup-inform` with no args). Capture wall-clock time from prompt
invocation to final Markdown table render.

### 4.4 Optimization opportunities

Investigate during perf testing. Each optimization gets: measure → propose → land as
separate PR if delta exceeds the threshold of interest.

- **Projection trimming.** `buildSiteContentQuery` requests 9 fields. Drop `Updated At`
  if unused by downstream rendering. Measure payload-size delta.
- **Server-side row limits.** Site Content can be 10k+ rows. Tune `MAX_RESULT_LIMITS`
  per tool. Document recommended values per site size.
- **Project-name cache TTL.** 5-minute TTL may be too short for static project trees;
  benchmark + bump if `list-projects` becomes the dominant cost.
- **VDS streaming.** VDS supports streaming responses; current impl materializes the
  full payload. Investigate streaming for very large sites.
- **Cohort summarization.** For very large reports (≥ 1k stale items), group by
  threshold-day cohorts (180d / 90d / 30d) with drilldown per cohort instead of one
  giant table.
- **Parallel REST calls.** `adminGate.assertAdmin` and
  `adminInsightsResolver.resolveDatasetLuid` currently run sequentially inside the
  report tool. They are independent and could run via `Promise.all`.
- **HTTP keep-alive.** Confirm Zodios reuses HTTP connections across the in-tool REST +
  VDS calls.
- **Metadata API redundancy.** Replace per-call `get-datasource-metadata` lookups in
  the resolver with a one-shot list of all admin datasets per site, cached.
- **Prompt-output token cost.** Markdown table for 10k stale items exceeds typical
  client render budgets. Cap at top-N (default 200) with an `--all` flag for full export.

---

## 5. Acceptance criteria & sign-off

### 5.1 PRD success-criteria gate

Reproduce PRD §Success Criteria thresholds. Append a new column per cycle.

| Metric | Target | Cycle 1 measured | Pass/Fail | Owner | Date |
|---|---|---|---|---|---|
| Tool Call Accuracy | ≥ 90% | _TBD_ | ☐ | | |
| Faithfulness Score | ≥ 0.95 | _TBD_ | ☐ | | |
| Task Success Rate | ≥ 70% | _TBD_ | ☐ | | |
| Single tool call P95 (scaled) | < 1 min | _TBD_ | ☐ | | |
| Full Inform prompt run | < 10 min | _TBD_ | ☐ | | |
| Speedup vs. manual | ≥ 2× | _TBD_ | ☐ | | |
| User Acceptance Rate (UAT) | ≥ 30% | _TBD_ | ☐ | | |

### 5.2 Sign-off

| Role | Name | Date | Notes |
|---|---|---|---|
| PM | _TBD_ | | |
| Eng Lead | _TBD_ | | |
| QA | _TBD_ | | |
| Customer Zero attestation | _TBD_ | | At least one full JTBD execution per PRD success measure |

---

## 6. Issue tracking

- Per-issue log lives at `~/.claude/plans/tmcp-admin-tools-testing-issues.md` (engineer's
  local working file). Each entry: status, severity, repro, root cause, fix.
- Confirmed defects get filed in GUS under the epic and linked here.
- Issues that need code changes get a follow-up WI; issues that block sign-off get
  flagged on the PRD success-criteria gate above.

| Issue # | GUS WI | Title | Status |
|---|---|---|---|
| 001 | (n/a) | LLM mis-applies stale-threshold filter | fixed (Path B redesign) |
| 002 | (n/a) | TS Events / Site Content field caption mismatch | fixed (Increment 4 + numeric Item ID coerce) |

---

## 7. Appendix

### 7.1 Sample mcpJam connection config

```json
{
  "name": "tableau-mcp",
  "transport": "http",
  "url": "https://<heroku-app>.herokuapp.com/mcp",
  "auth": {
    "type": "oauth",
    "issuer": "https://<oauth-issuer>",
    "scopes": [
      "tableau:mcp:datasource:read",
      "tableau:mcp:workbook:read",
      "tableau:mcp:content:read"
    ]
  }
}
```

### 7.2 Sample Heroku deploy

```bash
heroku create my-tmcp
heroku config:set \
  ADMIN_TOOLS_ENABLED=true \
  STALE_CONTENT_MIN_AGE_DAYS=90 \
  TRANSPORT=http \
  AUTH=oauth \
  OAUTH_ISSUER=https://<issuer> \
  --app my-tmcp
git push heroku main
```

### 7.3 Sample seed-script invocations

```bash
node tests/scripts/seed-cloud-site/seed-projects.ts --count 50
node tests/scripts/seed-cloud-site/seed-users.ts --count 1000 --manifest seed-manifest.json
node tests/scripts/seed-cloud-site/seed-datasources.ts --count 1000
node tests/scripts/seed-cloud-site/seed-workbooks.ts --count 10000
node tests/scripts/seed-cloud-site/seed-access-patterns.ts --coverage 0.3
node tests/scripts/seed-cloud-site/seed-extracts.ts --count 200
```

### 7.4 Sample VDS query bodies (raw probes)

**TS Events — last access per item:**

```json
{
  "query": {
    "fields": [
      { "fieldCaption": "Item Id" },
      { "fieldCaption": "Item Type" },
      { "fieldCaption": "Event Date", "function": "MAX", "fieldAlias": "last_access" }
    ],
    "filters": [
      { "field": { "fieldCaption": "Event Type" }, "filterType": "SET",
        "values": ["Access"], "exclude": false },
      { "field": { "fieldCaption": "Item Type" }, "filterType": "SET",
        "values": ["Workbook", "Datasource"], "exclude": false }
    ]
  }
}
```

**Site Content — universe with Last Accessed At, excluding Admin Insights project:**

```json
{
  "query": {
    "fields": [
      { "fieldCaption": "Item ID" },
      { "fieldCaption": "Item Type" },
      { "fieldCaption": "Item Name" },
      { "fieldCaption": "Item Parent Project Name" },
      { "fieldCaption": "Owner Email" },
      { "fieldCaption": "Created At" },
      { "fieldCaption": "Updated At" },
      { "fieldCaption": "Last Accessed At" },
      { "fieldCaption": "Size (bytes)" }
    ],
    "filters": [
      { "field": { "fieldCaption": "Item Type" }, "filterType": "SET",
        "values": ["Workbook", "Datasource"], "exclude": false },
      { "field": { "fieldCaption": "Item Parent Project Name" }, "filterType": "SET",
        "values": ["Admin Insights"], "exclude": true }
    ]
  }
}
```

### 7.5 Reference links

- [PRD](https://docs.google.com/document/d/1BIhQBq8sSRdQOzlLcQZn0S1pR4lHcJi8Q5HE9sQatcs/edit)
- [Plan doc](https://docs.google.com/document/d/148av48p_nM8VDk8awRh49CmkhLI23gYsGZODxlR-SGc/edit)
- [JTBD breakdown](https://docs.google.com/document/d/1DMp-4P5ighq027IjA9iBBWLE_6TEEdjW_P1X1dMzVKs/edit)
- [Stale content research](https://docs.google.com/document/d/1M019mY3GWh3qaLoEtZznTxaYdi-G-Z2JWpTUk285bqo/edit)
- [Epic](https://gus.lightning.force.com/lightning/r/ADM_Epic__c/a3QEE000002AWIP2A4/view)
- [This WI (W-22551544)](https://gus.lightning.force.com/lightning/r/ADM_Work__c/a07EE00002aJZhMYAW/view)
- Driving WIs (cross-ref): W-22551291, W-22551323, W-22551424, W-22551007, W-22585763, W-22444374, W-21971012.

### 7.6 Google Doc mirror

When this doc stabilizes, mirror to a Google Doc and record the URL here:

| | URL |
|---|---|
| Google Doc | _TBD_ |
| Last sync | _TBD_ |
