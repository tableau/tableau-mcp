# Current Workbook Field Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Desktop tool that finds fields in the open workbook and reports only placements proven by worksheet XML.

**Architecture:** A pure metadata analyzer parses workbook XML, joins the existing field catalog to explicit worksheet shelves and mark encodings, and returns a bounded structured result. A thin Desktop tool resolves the session, reads the workbook once, calls the analyzer, and exposes it through the standard registry and `dynamic-authoring` profile.

**Tech Stack:** TypeScript, Zod, ts-results-es, existing Desktop XML metadata parser, Vitest.

**Spec:** `.work/specs/current-workbook-field-search.md`

## Global Constraints

- Start from `origin/feature/desktop` and do not touch the user's dirty `pr-773` checkout.
- Use `getWorkbookXml`, `resolveSession`, `listAvailableFields`, `parseXML`, and existing field-reference helpers where they fit.
- One tool file and one colocated tool test; no new External Client API wrapper is needed.
- Errors go through `DesktopTool.logAndExecute` and typed `McpToolError` results.
- Set `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, and `openWorldHint: false`.
- Do not edit `package-lock.json`, generated files, lockstep-core files, prompts, or knowledge.
- Do not raise the tools/list byte budget to make this tool fit.

---

### Task 1: Implement and register `search-workbook-fields`

**Files:**
- Create: `src/desktop/metadata/searchWorkbookFields.ts`
- Create: `src/desktop/metadata/searchWorkbookFields.test.ts`
- Modify: `src/desktop/metadata/index.ts`
- Create: `src/tools/desktop/authoring/fields/searchWorkbookFields.ts`
- Create: `src/tools/desktop/authoring/fields/searchWorkbookFields.test.ts`
- Modify: `src/tools/desktop/tools.ts`
- Modify: `src/tools/desktop/toolName.ts`
- Modify: `src/server.desktop.ts`
- Modify: `src/server.desktop.test.ts`
- Modify only if the existing assertion requires it: `src/tools/toolName.test.ts`

**Interfaces:**
- Consumes: `listAvailableFields(workbookXml)`, `parseXML(workbookXml)`, `resolveSession(session)`, `getWorkbookXml({ executor, signal })`.
- Produces: `searchWorkbookFields(workbookXml: string, query: string, limit?: number): SearchWorkbookFieldsResult` and `getSearchWorkbookFieldsTool(server)`.

- [ ] **Step 1: Write pure analyzer tests before production code**

Use a literal workbook fixture with two datasources, duplicate captions, a calculated field, field folders, two worksheets, Rows/Columns shelves, mark encodings, and datasource-dependency declarations. Assert literal results for caption, local-name, datasource, folder, and formula matches; cross-sheet placements; dependency non-placement; deterministic ordering; and truncation metadata.

```ts
expect(searchWorkbookFields(WORKBOOK_XML, "profit", 1)).toEqual({
  query: "profit",
  totalMatches: 2,
  truncated: true,
  matches: [EXPECTED_FIRST_MATCH],
  usageScope: "worksheet shelves and mark encodings only",
});
```

- [ ] **Step 2: Run the analyzer test and record RED**

Run: `npx vitest run src/desktop/metadata/searchWorkbookFields.test.ts`

Expected: FAIL because the analyzer module does not exist.

- [ ] **Step 3: Implement the smallest pure analyzer**

Define and export the result types. Trim and lowercase the query once. Use the existing field catalog for field identity. Parse worksheets once, inspect only Rows, Columns, and mark-encoding nodes, and match placements by the workbook's canonical field reference. Sort matches and placements by stable text keys before applying the limit. Preserve `totalMatches` before truncation.

Do not infer use from datasource dependencies and do not emit the word `unused`.

- [ ] **Step 4: Run analyzer tests GREEN**

Run: `npx vitest run src/desktop/metadata/searchWorkbookFields.test.ts`

Expected: PASS.

- [ ] **Step 5: Write tool and registry tests before tool code**

Tests must prove that the tool trims and validates `query`, defaults `limit` to 20, caps it at 100 through Zod, resolves the session, calls `getWorkbookXml` exactly once with `extra.signal`, returns an empty successful result for no matches, converts workbook-read errors to `DesktopCommandExecutionError`, and carries the four required annotations. Registry tests must prove the tool appears once in the full Desktop surface and in `DYNAMIC_AUTHORING_TOOL_PROFILE`.

- [ ] **Step 6: Run tool and registry tests and record RED**

Run:

```bash
npx vitest run \
  src/tools/desktop/authoring/fields/searchWorkbookFields.test.ts \
  src/server.desktop.test.ts \
  src/tools/toolName.test.ts
```

Expected: FAIL because the tool is not implemented or registered.

- [ ] **Step 7: Implement the thin tool and registration**

Use the established factory shape:

```ts
const paramsSchema = {
  session: z.string().optional().describe("Session ID; optional if pinned or unique."),
  query: z.string().trim().min(1).describe("Case-insensitive text to find in workbook fields."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum matches; defaults to 20."),
};
```

Inside `DesktopTool.logAndExecute`, resolve the session, get the executor, call `getWorkbookXml` once with the request signal, map an error to `DesktopCommandExecutionError`, and return `Ok(searchWorkbookFields(xml, query, limit ?? 20))`. Register the factory and name, then add the name to `DYNAMIC_AUTHORING_TOOL_PROFILE`. Update exact profile counts only after deriving them from the current branch.

- [ ] **Step 8: Run focused and touched-module tests GREEN**

Run:

```bash
npx vitest run \
  src/desktop/metadata/searchWorkbookFields.test.ts \
  src/tools/desktop/authoring/fields/searchWorkbookFields.test.ts \
  src/server.desktop.test.ts \
  src/tools/toolName.test.ts
```

Expected: PASS without increasing any byte budget.

- [ ] **Step 9: Run repository gates**

Run:

```bash
npx tsc --noEmit
npm run lint
npm run build:desktop
node scripts/check-lockstep.mjs
scripts/agent-check
```

Expected: all pass. If a full gate exposes an unrelated base failure, record the exact signature rather than changing unrelated code.

- [ ] **Step 10: Leave the branch uncommitted for orchestrator review**

Report the RED and GREEN commands, exact files changed, tool-list byte effect, and anything not live-proven. Do not run git mutations.
