---
sidebar_position: 1
---

# List Flows

Retrieves a list of Tableau Prep flows on a site.

## APIs called

- [Query Flows for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flows_for_site)

## Required Tableau API scopes

When the MCP server authenticates with OAuth (connected-app JWT), this tool requests:

- `tableau:flows:read`
- `tableau:mcp_site_settings:read`

Note that flows use the dedicated `tableau:flows:read` scope, not the `tableau:content:read` scope
used by workbooks, data sources, and views. See
[OAuth configuration](../../configuration/mcp-config/oauth.md) for how scopes are negotiated.

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
in the format `field:operator:value`. Multiple expressions are combined with a comma using a logical
AND.

Supported fields and operators. This list mirrors the official
[Filtering and Sorting](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
reference for the Flows endpoint. The Tableau Flows endpoint accepts a narrower filter-field set
than other content endpoints — `ownerEmail`, `ownerDomain`, and `tags` are **not** supported and
will be rejected by the server.

| Field         | Operators              | Notes                                                                                 |
| ------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `createdAt`   | `eq, gt, gte, lt, lte` | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` or date-only `YYYY-MM-DD` (auto-promoted to midnight) |
| `name`        | `eq, in`               | Flow name (case-sensitive — pass exact case; whitespace-sensitive)                    |
| `ownerName`   | `eq`                   | **Matches `user.fullName` (display name), NOT login/email.** See "ownerName" below.   |
| `projectId`   | `eq`                   | Project UUID                                                                          |
| `projectName` | `eq, in`               | Project name (case-sensitive — pass exact case; whitespace-sensitive)                 |
| `updatedAt`   | `eq, gt, gte, lt, lte` | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` or date-only `YYYY-MM-DD` (auto-promoted to midnight) |

Examples:

- `name:eq:DailySalesCleanup`
- `projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3`

#### Caller-role visibility (important for sizing the response)

The set of flows Tableau returns depends on the caller's role on the site:

- **Non-admin callers** — Tableau returns only flows the caller has Read (view) permission for. On
  shared sites this is still typically many more flows than the user owns, so an unfiltered call is
  rarely "just my flows".
- **Server / site-admin callers** — Tableau returns **every flow on the site** regardless of
  permissions; the permission filter does not apply. On large enterprise sites this can be thousands
  of flows, so [`mcp.resultInfo.truncated`](#response-shape) is much more likely to come back `true`
  on the first call.

In both cases, scope down with `ownerName` (matched against `fullName` only — not email/login/UUID),
`projectId` (UUID), `projectName`, or a date-range `createdAt` / `updatedAt` filter when the user's
intent is narrower than "every flow visible to me on this site".

#### Filter value semantics (important)

Several filter fields have non-obvious value contracts that the official spec under-specifies or
contradicts. The findings below were verified live against Tableau REST 3.30. When this tool detects
a likely shape-mismatch on an empty result, the response includes a structured **empty-result hint**
so the LLM can self-correct rather than reporting a misleading zero.

##### `ownerName` — matches display name only

Matches against `user.fullName` (display name) only. It does **not** match login (`user.name`, often
an email on federated sites) or user id. The Flows endpoint does not currently expose `ownerEmail`,
`ownerDomain`, or `ownerId` filter fields, so `ownerName` is the only owner-based filter available.

```
ownerName:eq:Jane Doe                                   # ✅ matches by display name
ownerName:eq:jane.doe@example.com                       # ❌ silently returns 0 flows
ownerName:eq:711e59cf-d1c0-446e-be48-3673ae067f7b       # ❌ silently returns 0 flows
```

If the supplied value looks like a login (no whitespace), email (contains `@`), or user id
(canonical UUID shape) and the response is empty, the tool returns a recovery hint suggesting either
a Users REST API lookup or re-listing without the filter to inspect `owner.fullName`.

##### `projectId` — must be a UUID

Must be the project's UUID (canonical 8-4-4-4-12 hex form). Any other value (including a project
name) silently returns 0 results.

```
projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3   # ✅ matches the named project
projectId:eq:Finance                                # ❌ silently returns 0 flows
projectId:eq:not-a-uuid                             # ❌ silently returns 0 flows
```

If the supplied value is not in canonical UUID shape and the response is empty, the tool returns a
recovery hint suggesting `projectName:eq:<name>` or a Projects REST API lookup.

##### `name`, `projectName` — case-sensitive and whitespace-sensitive

Per the official Tableau REST API spec, values are **case-sensitive** — pass the exact name as it
appears in Tableau (e.g. `Superstore Flow`, not `superstore flow`). Leading and trailing whitespace
are also significant: ` Sales Cleanup` (with a leading space) silently returns 0 results. Always
pass the exact, trimmed name.

Some Tableau versions are observed to match leniently in practice, but don't rely on it — passing
exact case and trimmed whitespace is portable across all versions.

##### `createdAt`, `updatedAt` — ISO 8601 with `Z` suffix, or date-only

Two accepted forms:

1. Full ISO 8601 with the `Z` UTC suffix, e.g. `2025-01-01T00:00:00Z`.
2. Date-only `YYYY-MM-DD`, e.g. `2025-01-01` — auto-promoted to midnight UTC
   (`2025-01-01T00:00:00Z`) before being sent to Tableau. Use this when the user spoke about a
   calendar day with no time-of-day ("flows updated before Nov 20").

Other shapes — locale-style `MM/DD/YYYY` (ambiguous across locales), no-timezone
(`2025-01-01T00:00:00`), and offset-style (`2025-01-01T00:00:00+00:00`) — are rejected client-side.
The Tableau server itself also accepts `+00:00`-style offsets, but the tool pins `Z` to keep the
contract small and the validation message unambiguous.

```
createdAt:gt:2025-01-01T00:00:00Z       # ✅ canonical
createdAt:gt:2025-01-01                 # ✅ auto-promoted to 2025-01-01T00:00:00Z
createdAt:gt:2025-01-01T00:00:00        # ❌ tool rejects (no timezone)
createdAt:gt:2025-01-01T00:00:00+00:00  # ❌ tool rejects (offset, not Z)
createdAt:gt:01/01/2025                 # ❌ tool rejects (locale-ambiguous)
```

##### `name`, `projectName` with `in:` — bracket-and-comma form

Multi-value lists use the form `name:in:[Foo,Bar]`. List items are not quoted; commas inside list
items are not supported (this is a Tableau filter-language limitation, not a tool one).

<hr />

### `sort`

A sort expression in the format `field:asc` or `field:desc`. Combinable with `filter`.

Example: `createdAt:desc`

<hr />

### `pageSize`

The value of the `page-size` argument provided to the
[Query Flows for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flows_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all flows are retrieved or the `limit` argument has been reached.

Example: `1000`

<hr />

### `limit`

The maximum number of flows to return. The tool will return at most this many flows.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Response-size guidance

This tool returns one record per flow including project, owner, tags, and parameters. On shared
sites the visible flow count can easily reach hundreds, so the tool description steers the LLM
toward the narrowest call that answers the user's question:

- **Targeted lookups** ("does flow X exist?", "who owns flow Y?") — always pass `filter` and a small
  `limit` (e.g. 5).
- **Scoped exploration** ("flows in the Finance project") — pass `filter` (`projectId` or
  `projectName`) plus a moderate `limit` (e.g. 25–50).
- **Broad analytics** ("how many flows per project?") — pass a moderate `limit` (e.g. 100) and
  paginate further only when explicitly asked.
- Only call without `limit` when the user explicitly requests a complete or exhaustive listing.

Site administrators can also impose a hard cap with
[`MAX_RESULT_LIMITS=list-flows:N`](../../configuration/mcp-config/env-vars.md#max_result_limits),
which always wins over the LLM-supplied `limit`.

## Response shape

The tool returns a JSON object:

```json
{
  "flows": [
    /* one record per flow, see "Example result" below */
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 12,
      "truncated": false,
      "totalAvailable": 12
    }
  }
}
```

The top-level `flows` array and `mcp.resultInfo` are **always present**. `resultInfo` reports
whether the returned list is complete, so the answer never depends on the _absence_ of a signal:

- `returnedCount` — the number of flows in `flows`.
- `truncated` — `false` means `flows` is the **complete** set matching the request (every flow the
  caller can see, subject to any `filter`); `true` means more matching flows exist on the server
  than were returned.
- `truncationReason` — present only when `truncated` is `true`:
  - `"requested-limit"` — the caller's own `limit` argument cut the result short. Call again with a
    higher `limit` (or omit it) to fetch more.
  - `"admin-cap"` — a site-administrator per-call cap
    ([`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) or
    `MAX_RESULT_LIMITS=list-flows:N`) cut the result short, **and** the caller did not request an
    equal-or-smaller `limit` itself. The `limit` argument cannot raise the cap, so narrow the
    `filter` until the matching set fits, or ask the administrator to raise the cap.
- `totalAvailable` — the total number of flows matching the request on the server (across all pages,
  ignoring `limit`). **Present only when no server-side allow-list
  ([`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/tool-scoping.md#include_project_ids) /
  [`INCLUDE_TAGS`](../../configuration/mcp-config/tool-scoping.md#include_tags)) is configured** — that count is taken
  before the tool's allow-list filtering, so under a bounded context it would overstate the
  accessible total and is therefore omitted rather than risk a misleading "N of M". When present and
  `truncated` is `true`, use it to report "N of M" (e.g. "showing 100 of 430").

When `truncated` is `true`, do **not** report `returnedCount` as the total. If `totalAvailable` is
present, report "N of M" (e.g. "showing 100 of 430"); otherwise say "at least N". A truncated
example:

```json
{
  "flows": [
    /* the first 100 matching flows */
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 100,
      "truncated": true,
      "truncationReason": "admin-cap",
      "totalAvailable": 430
    }
  }
}
```

:::tip For client / LLM authors `mcp.resultInfo` is a signal **for the model**, not text to show the
user. Translate it into one plain sentence — "These are all 12 flows matching your request" or "Here
are the first 100 of 430; more match" — and never surface the field names (or the absence of a
warning) to the end user. :::

## Example result

```json
{
  "flows": [
    {
      "id": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
      "name": "Sales Cleanup",
      "description": "Cleans up the daily sales feed",
      "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/flows/3",
      "fileType": "tflx",
      "createdAt": "2024-11-06T04:57:55Z",
      "updatedAt": "2024-11-06T21:31:00Z",
      "project": {
        "id": "6f8a2966-e173-11e8-ae74-ffd84c19d7f3",
        "name": "Default",
        "description": "The default project that was automatically created by Tableau."
      },
      "owner": {
        "id": "711e59cf-d1c0-446e-be48-3673ae067f7b",
        "name": "jane.doe@example.com",
        "fullName": "Jane Doe",
        "email": "jane.doe@example.com",
        "siteRole": "Creator"
      },
      "tags": { "tag": [{ "label": "sales" }] }
    }
  ]
}
```

The `project` and `owner` objects above include all fields that Tableau Server / Cloud is observed
to return. The official spec only documents `id` (and `name` on `project`); the additional fields
are captured opportunistically as optional properties and may be absent on older versions or for
users without visibility into the owner's profile.
