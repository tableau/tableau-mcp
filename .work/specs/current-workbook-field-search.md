# Current workbook field search

## Decision

Add one read-only Desktop tool, `search-workbook-fields`, that searches the field catalog of the open workbook and reports verified worksheet placements.

This is the first Desktop-local discovery slice for the P1 work. It does not claim that a field is unused and does not search Tableau Cloud or published content.

## User contract

Input:

```ts
{
  session?: string;
  query: string;
  limit?: number;
}
```

- `query` is trimmed and must not be empty.
- Search is a case-insensitive substring match over caption, local name, formula, folder, and datasource.
- `limit` defaults to 20 and cannot exceed 100.

Output:

```ts
{
  query: string;
  totalMatches: number;
  truncated: boolean;
  matches: Array<{
    datasource: string;
    caption: string;
    localName: string;
    columnRef: string;
    role: string;
    datatype?: string;
    formula?: string;
    matchedOn: Array<"caption" | "localName" | "formula" | "folder" | "datasource">;
    placements: Array<{
      worksheet: string;
      location: "rows" | "columns" | "encoding";
      encoding?: string;
    }>;
  }>;
  usageScope: "worksheet shelves and mark encodings only";
}
```

Placements come only from explicit Rows, Columns, and mark encodings. Datasource dependency declarations are not placements. A match with no placements is reported without calling it unused.

## Product boundaries

- Use the current workbook XML through the existing read wrapper and session resolver.
- Return structured results, never whole-workbook XML.
- Set MCP annotations to read-only, idempotent, non-destructive, and closed-world.
- Add the tool to the Desktop registry and `dynamic-authoring` profile. TAS needs no special routing.
- Do not add a new API endpoint, wrapper, dependency, search service, or version bump in this slice.

## Acceptance

- The tool finds matches on every supported field attribute.
- It reports Rows, Columns, and mark-encoding placements across worksheets.
- Duplicate captions in different datasources stay distinct.
- Ordering and truncation are deterministic.
- Empty queries fail through the normal typed-error path; no matches succeed with an empty list.
- The live workbook is read once and the abort signal is forwarded.
- Registry, tool-name, dynamic-profile, type, lint, build, lockstep, and full agent checks pass.
- TAS lists the tool once with read-only annotations when pointed at the built Desktop MCP.

## Non-goals

Filters, actions, dashboard references, calculation dependency graphs, authoritative unused-field detection, statistics, performance advice, Cloud search, navigation, and workbook mutation.
