---
sidebar_position: 5
---

# Search Content by Tag

Tag-only discovery uses the existing read-only [List Workbooks](../workbooks/list-workbooks.md),
[List Views](../views/list-views.md) and [List Datasources](../data-qna/list-datasources.md) tools.
No separate search tool or write permission is needed.

## Exact and ANY-tag matching

All three list tools accept the optional `tagLabels` argument:

```json
{ "tagLabels": ["Sales"], "pageNumber": 1, "limit": 100 }
```

One distinct label produces `filter=tags:eq:Sales`, matching an exact, case-sensitive tag on the
content. Content may also carry other tags. This is tag membership, not a substring or wildcard
search, and it searches each resource's own tags rather than inheriting its workbook's tags.

```json
{ "tagLabels": ["Sales", "Finance"], "pageNumber": 1 }
```

Multiple distinct labels produce `filter=tags:in:[Sales,Finance]`, matching **ANY** label (logical
OR). Exact duplicates are removed; case and Unicode are preserved. Raw `filter` expressions remain
available, including `tags:eq:Sales` and `tags:in:[Sales,Finance]`.

Additional non-tag filter fields combine using AND:

```json
{ "tagLabels": ["Sales"], "filter": "projectName:eq:Finance" }
```

Passing `tagLabels` together with a raw `tags` clause is rejected, avoiding silent overwrites.
Tableau's raw filter behavior is last-field-wins for repeated fields:
`tags:eq:Sales,tags:eq:Finance` only searches `Finance`; it does **not** implement an all-tags AND.
To require all labels, retrieve every permitted page of the ANY-tag results and apply an exact
all-label check to the returned `tags.tag[].label` values. Report incomplete results if pagination
or configured result limits prevent a complete scan. This client-side check is not a new server
filter operator.

## Supported content, paging and boundaries

The official filter tables document `tags` with `eq`/`in` for workbooks, views and data sources.
They do not document that field for projects or flows. The existing `search-content` ranked
free-text tool exposes type, owner and modified-time filters; a keyword query is not a guaranteed
exact tag-only search. Use the three list tools for this workflow.

Native REST filtering is available from API 2.3. The tools retain their normal read-only scopes,
single-page `{ data, totalAvailable }` response, `pageNumber`/`limit` arguments and configured
result ceiling. Bounded-context filtering still applies to every returned page. `totalAvailable` is
the server's pre-bounded-context count, so it is not a guarantee that all those items are visible
through this MCP server. The typed tag input does not trigger a full-site scan or automatic
pagination. Raw REST page notifications are disabled for these list tools, so default debug logging
cannot expose items before bounded-context filtering. Normal tool invocation logging remains active.
Malformed response failures are curated without exposing unfiltered response payloads.

## Representability and tool limits

Tableau documents that filter values cannot contain `&` or comma, even when URL-encoded. Its
brackets delimit `in` lists; no documented tag-value escaping is used here. The typed convenience
path therefore rejects these values instead of allowing one label to change filter structure.

These are **local tool restrictions**, separate from tag creation and Tableau's tag schema:

- 1–50 submitted labels per call, each at most 256 UTF-16 code units
- No `&`, comma, brackets, ASCII controls, invalid Unicode or surrounding whitespace
- No literal `%XX` percent-escape sequences, avoiding ambiguous server decoding

Pass decoded text and let the SDK serialize the query parameter. Ordinary spaces inside a label,
Unicode, `#`, `?`, colons and ordinary literal percent signs are kept. No mutation namespace guard
applies to searches, so `pending-deletion-2026-10-14` may be looked up safely. Labels that the API
filter grammar cannot represent can still exist on content; this convenience path cannot search
those exact labels.

## Reference

[Official filtering rules, per-resource fields and tag OR example](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
