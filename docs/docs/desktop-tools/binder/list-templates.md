---
sidebar_position: 3
---

# List Bundled Chart Templates

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Searches the worksheet chart templates available to the MCP server on this machine — the set
that ships in-package, plus any additional templates and saved bookmarks found in the local
%product_name% repository — and returns a page of compact summaries. Each summary reports the
template's id, where it came from, whether it currently passes worksheet-template validation
(and, if not, what blocks it), the visible mark and shelf channels it provides, any
same-field groups, and a signature of the structural slots it expects fields to be bound to
(required and optional). Use it to find a template before binding one against the open
%product_name% workbook.

Every argument is optional: with none supplied the tool returns the first page of the whole
catalog, ordered by template id. Results are **paginated** — one page per call, with a
continuation cursor (`nextCursor`) for the next one — so a caller that needs the full catalog must page
through it. Supply `query` to search by template id, `requiredChannels` to keep only templates
that provide every listed mark or shelf channel, and `includeSlots` to get one template's
slots in full.

## APIs called

This tool makes **no** %ecapi_name% call. It reads the template library on the local machine
and returns the matching summaries entirely in-process — it does not contact the open
%product_name% instance, the %ecapi_name%, or the Tableau Cloud/Server REST API, and it
requires no session. Because there is no external call, there are no OAuth scopes and no
per-session loopback bearer token involved.

- Lists the template catalog available on this machine: the templates that ship in-package,
  plus any templates and saved bookmarks in the local %product_name% repository. A template id
  supplied by a higher-precedence source shadows a same-named one from a lower-precedence
  source, and the surviving entry is flagged as having done so. Local filesystem; no
  %ecapi_name% endpoint is called.
- Reads and converts each template the requested page examines, deriving that template's
  structural slot signature and its current worksheet-template validation status. Performed
  in-process (not an %ecapi_name% call).
- Reports every template that was found but could not be used as a diagnostic entry rather
  than dropping it silently. Assembled in-process; no %ecapi_name% endpoint is called.

## Optional arguments

### `query`

Search text matched against template **ids** — not against descriptions, keywords, or the
template's contents. Trimmed, `1`–`256` characters. When omitted, every template in the
catalog is a candidate and the page is ordered by id.

Matching runs in one of two modes, chosen automatically:

- **Substring** — when at least one template id contains the query as a case-insensitive
  substring, only those templates match, ordered by id
- **Token** — otherwise the query is split on non-alphanumeric characters and matched against
  the tokens of each template id; a template matches when it shares at least one token. Plural
  and participle forms fold together, so `ranked`, `ranking`, and `ranks` all match `rank`, and
  `bars`, `columns`, `maps`, `charts`, `rates`, and `ratios` match their singular form.
  Orientation and styling words count as synonyms of the shape that has them: `horizontal`
  matches a `bar` template, `vertical` a `column` template, and `filled` a `choropleth`
  template. Matches are ranked by score — an orientation match counts most, then `rank`, then
  any other shared token — with a shorter id breaking a tie and id order breaking the rest

#### Specialized variants

A template id that carries a double-underscore marker (for example
`spatial__choropleth__map-rates-or-ratios-by-region`) is a specialized variant of a canonical
chart shape. A token search keeps those variants behind the canonical template unless they
score strictly better than the best canonical match, so `choropleth map` returns
`spatial-choropleth-map` while `rate choropleth` surfaces the rate variant. Naming a
specialized id exactly always returns that template.

#### Example

```json
{ "query": "ranked horizontal bar" }
```

<hr />

### `cursor`

Previous `nextCursor` from the last page — pass it back to continue. Maximum `255`
characters. Omit it to get the first page.

The cursor is the id of the **last template the previous page examined**, and paging resumes at
the candidate immediately after it.

#### How to page through results

`nextCursor` is the only "is there more?" signal. It is a template id while candidates remain
past the current page, and `null` once the last candidate has been examined. So: call once
without `cursor`; while `nextCursor` is non-null, call again passing it as `cursor`; stop when
`nextCursor` is `null`.

A page can be legitimately empty — `count: 0` and `templates: []` — while still returning a
non-null `nextCursor`, because `pass1EligibleOnly` filters the examined candidates after the
page has been cut. Keep paging until `nextCursor` is `null` rather than stopping at the first
empty page.

:::note[Page with the filters that produced the cursor]
A cursor is only meaningful for the filters it came from, since those filters decide the
candidate list it indexes into. Pass the same `query` and `pass1EligibleOnly` alongside it. A
cursor that is not the id of a candidate under the current filters is refused with
`Invalid template cursor "<id>" for the current filters.` and no page is returned.
:::

#### Example

```json
{ "query": "bar", "cursor": "ranking-ordered-bar" }
```

<hr />

### `limit`

Page size (default 20, max 50): how many candidate templates to examine for this page.
Integer. Range: `1`-`50`. Defaults to `20`, or to `1` when `includeSlots` is `true`.

This caps the candidates **examined**, not the templates returned: with `pass1EligibleOnly` a
page can return fewer summaries than it examined, which is why the result reports `scanned`
separately from `count`.

A compact page is also held to a response-size budget of `16,384` bytes. When the summaries for
the examined candidates would exceed it, the tool drops candidates from the end of the page
until they fit and reports the reduced `scanned` count — so a page may be shorter than the
limit you asked for, and `nextCursor` picks up from the last candidate that survived. If even a
single template's summary is over the budget, the call fails rather than returning a truncated
page.

:::note
If the metadata for the page cannot fit, the tool refuses: template catalog metadata exceeds the 16384-byte response limit for a compact page, or the 12288-byte response limit when `includeSlots` is true.
:::

#### Example

```json
{ "limit": 5 }
```

<hr />

### `includeSlots`

When `true`, include the template's slots (`limit` must be 1). The returned template then
carries its full per-slot structural facts as a `slots` array, instead of only the compact
`slot_signature` every summary has. Defaults to `false`.

Each entry in `slots` reports the slot's `slot_id`, its `kind` (for example `categorical`,
`quantitative`, `geo`, or `temporal`), whether it is `required`, whether it is `bindable` (a
generated or calculated slot is not — the binder must not fill it), its `derivation` (the
aggregation the template applies at that position, such as `none` or `sum`), the structural
`role` it fills on the sheet (for example `rows` or `cols`), how the slot is used for binding
(`binding_usage`) and which channels a calculation on it feeds (`calculation_channels`), and —
when the template declares them — its `semantic_role`, `communicative_role`, and `purpose`.

Detail is deliberately one template at a time: `includeSlots` requires `limit` to be `1`.
Omitting `limit` satisfies that (it defaults to `1` in this mode); any other value is refused
with `includeSlots requires limit=1 so one bounded structural descriptor is returned.` A detail
response is held to a `12,288`-byte budget and, unlike a compact page, is not trimmed to fit —
a descriptor over the budget fails rather than coming back partial.

#### Example

```json
{ "query": "spatial-choropleth-map", "includeSlots": true }
```

<hr />

### `pass1EligibleOnly`

When `true`, only validation-passing templates (`pass1_eligible: true`) are returned.
Defaults to `false`, which returns every examined template along with its `pass1_eligible`
flag and its `pass1_blockers`.

Eligibility is computed from the template itself at call time, not read from a stored policy: a
template is ineligible when converting it leaves an unresolved reference behind, or when the
converted sheet already fails validation with an error that binding fields cannot fix. Each
blocker is reported as a short reason code with the offending detail appended.

:::note[The filter runs after the page is cut]
`pass1EligibleOnly` is applied to the candidates the page examined, not to the candidate list
that pagination walks. `count` can therefore be lower than `scanned`, and a page can come back
empty while `nextCursor` still points at more candidates — keep paging until `nextCursor` is
`null`.
:::

#### Example

```json
{ "pass1EligibleOnly": true, "limit": 10 }
```

<hr />

### `requiredChannels`
Visible mark and shelf channels every returned template must provide (_available September 2026 and later_). Each value is one of: `rows`, `cols`, `mark`, `color`, `size`, `text`, `label`, `detail`, `lod`, `tooltip`, `shape`, `path`, `geometry`, `angle`, `wedge-size`. Defaults to an empty list, which does not filter by channel.

A template is kept only when it provides **every** listed channel. Combine with `query` and `pass1EligibleOnly` as needed; the filter is applied before the page is cut.

#### Example

```json
{ "requiredChannels": ["color", "size"], "limit": 10 }
```

## Notes and caveats

- **Only structural facts are returned.** A summary describes a template's shape — slot ids,
  kinds, roles, and derivations. Field names, captions, and datasource names from the workbook
  a template was authored against are never included, so a template is safe to browse without
  disclosing the data it was built from.
- **Templates that cannot be used are reported, not hidden.** The result's `diagnostics` names
  each template the catalog found but could not use — an id that is not a legal template name,
  a file that is unreadable or is not a valid template, a file over the `512` KB template size
  limit, or one that changed between being listed and being read. At most `20` entries are
  returned, with `truncated: true` when there were more.
- **`total` counts the whole catalog.** It is the number of catalog entries on this machine,
  including ones reported in `diagnostics`, and it does not change with `query`.
  `candidateCount` is the number of usable templates matching the current `query` — the
  population that pagination walks.

## Example results

### A search, first page (`query: "bar"`, `limit: 2`)

`nextCursor` is non-null, so more candidates remain past this page.

```json
{
  "total": 39,
  "candidateCount": 3,
  "scanned": 2,
  "count": 2,
  "nextCursor": "ranking-ordered-bar",
  "diagnostics": { "count": 0, "returned": 0, "truncated": false, "templates": [] },
  "templates": [
    {
      "template": "magnitude-horizontal-bar",
      "provenance": "protected",
      "overridesLowerPrecedence": false,
      "pass1_eligible": true,
      "pass1_blockers": [],
      "slot_signature": {
        "total": 2,
        "required": 2,
        "kinds": ["categorical", "quantitative"],
        "required_slots": [
          { "slot_id": "field_base_1", "kind": "categorical" },
          { "slot_id": "field_base_2", "kind": "quantitative" }
        ]
      }
    },
    {
      "template": "ranking-ordered-bar",
      "provenance": "protected",
      "overridesLowerPrecedence": false,
      "pass1_eligible": true,
      "pass1_blockers": [],
      "slot_signature": {
        "total": 2,
        "required": 2,
        "kinds": ["categorical", "quantitative"],
        "required_slots": [
          { "slot_id": "field_base_1", "kind": "categorical" },
          { "slot_id": "field_base_2", "kind": "quantitative" }
        ]
      }
    }
  ]
}
```

### The last page (`cursor` from the previous page)

Called as `{ "query": "bar", "limit": 2, "cursor": "ranking-ordered-bar" }`. `nextCursor` is
`null`, so this is the end of the results.

```json
{
  "total": 39,
  "candidateCount": 3,
  "scanned": 1,
  "count": 1,
  "nextCursor": null,
  "diagnostics": { "count": 0, "returned": 0, "truncated": false, "templates": [] },
  "templates": [
    {
      "template": "ranking-stacked-bar",
      "provenance": "protected",
      "overridesLowerPrecedence": false,
      "pass1_eligible": true,
      "pass1_blockers": [],
      "slot_signature": {
        "total": 3,
        "required": 2,
        "kinds": ["categorical", "quantitative"],
        "required_slots": [
          { "slot_id": "field_base_1", "kind": "categorical" },
          { "slot_id": "field_base_2", "kind": "quantitative" }
        ]
      }
    }
  ]
}
```

### One template in detail (`includeSlots: true`)

Called as `{ "query": "ranking-ordered-bar", "includeSlots": true }`, so `limit` defaults to
`1` and the single returned template carries its full `slots` array.

```json
{
  "total": 39,
  "candidateCount": 1,
  "scanned": 1,
  "count": 1,
  "nextCursor": null,
  "diagnostics": { "count": 0, "returned": 0, "truncated": false, "templates": [] },
  "templates": [
    {
      "template": "ranking-ordered-bar",
      "provenance": "protected",
      "overridesLowerPrecedence": false,
      "pass1_eligible": true,
      "pass1_blockers": [],
      "slot_signature": {
        "total": 2,
        "required": 2,
        "kinds": ["categorical", "quantitative"],
        "required_slots": [
          { "slot_id": "field_base_1", "kind": "categorical" },
          { "slot_id": "field_base_2", "kind": "quantitative" }
        ]
      },
      "slots": [
        {
          "slot_id": "field_base_1",
          "kind": "categorical",
          "required": true,
          "bindable": true,
          "derivation": "none",
          "role": ["rows"]
        },
        {
          "slot_id": "field_base_2",
          "kind": "quantitative",
          "required": true,
          "bindable": true,
          "derivation": "sum",
          "role": ["cols"]
        }
      ]
    }
  ]
}
```

### An ineligible template (`pass1EligibleOnly` omitted)

An ineligible template is still returned by default, with the reasons it cannot be bound as-is.

```json
{
  "total": 39,
  "candidateCount": 1,
  "scanned": 1,
  "count": 1,
  "nextCursor": null,
  "diagnostics": { "count": 0, "returned": 0, "truncated": false, "templates": [] },
  "templates": [
    {
      "template": "trend-indexed-growth",
      "provenance": "protected",
      "overridesLowerPrecedence": false,
      "pass1_eligible": false,
      "pass1_blockers": ["unresolved-table-calc-bareRefs: [Sales]"],
      "slot_signature": {
        "total": 2,
        "required": 2,
        "kinds": ["quantitative", "temporal"],
        "required_slots": [
          { "slot_id": "field_base_1", "kind": "temporal" },
          { "slot_id": "field_base_2", "kind": "quantitative" }
        ]
      }
    }
  ]
}
```

### A template that could not be used

The template was found but could not be read as a valid template, so it is reported in
`diagnostics` and left out of `templates`.

```json
{
  "total": 1,
  "candidateCount": 0,
  "scanned": 0,
  "count": 0,
  "nextCursor": null,
  "diagnostics": {
    "count": 1,
    "returned": 1,
    "truncated": false,
    "templates": [{ "template": "shared", "provenance": "custom", "issue": "invalid-or-unreadable" }]
  },
  "templates": []
}
```

## Related

- [`bind-template`](./bind-template.md) — resolve a chosen template's field slots to real datasource columns.
