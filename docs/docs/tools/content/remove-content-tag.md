---
sidebar_position: 4
---

# Remove Content Tag

`remove-content-tag` removes one exact label from a workbook, published view or published data
source. It calls the dedicated tag-delete endpoint with no request body, preserving unrelated tags.

## Arguments

- `resourceType`: `workbook`, `view` or `datasource`
- `resourceId`: the content's Tableau LUID (UUID format)
- `tagLabel`: the exact decoded label to remove, such as `売上 #1` (do not URL-encode it)

```json
{
  "resourceType": "view",
  "resourceId": "22222222-2222-4222-8222-222222222222",
  "tagLabel": "売上 #1"
}
```

A successful REST request returns an empty HTTP 204; the tool returns the resource and
`removedTagLabel`. Tableau errors, including permission failures and missing tags/content, are
reported as errors without an automatic retry. A generic 404 is never treated as success.

## Permissions and scopes

The Viewer registration floor does not grant removal authority. Tableau enforces owner,
administrator, project-leader or original-tagger rules as applicable to the content. Do not assume
Read permission lets every caller remove every tag.

OAuth requires `tableau:mcp:content:tags:write`. Each mutation uses only its selected tag scope:

- Workbook: `tableau:workbook_tags:delete`
- View: `tableau:view_tags:delete`
- Data source: `tableau:datasource_tags:delete`

REST API 1.0+ endpoint availability, API 3.27+ JWT scopes, deployment, defensive label limits and
bounded-context behavior are described in
[Add Content Tags](add-content-tags.md#deployment-and-permissions).

## Label and route safety

Pass raw decoded text. The SDK percent-encodes UTF-8 exactly once, matching the official Python
client's `quote(tag, safe="")`. For example, `Sales #1` becomes `Sales%20%231`, and `A&B?` becomes
`A%26B%3F`. Unicode, spaces, literal percent signs and ordinary URI punctuation are preserved.

The existing route guards remain unchanged. This MVP rejects labels containing slash/backslash,
dot/traversal segments or unsafe percent-encoded sequences, including literal `%2F` and `%2e%2e`.
This is a local safety restriction, not a Tableau-wide character rule. Such labels can be added in
the JSON body but cannot be removed by this tool; use Tableau's normal UI when authorized.

The tool rejects the reserved `pending-deletion` prefix and all its case/whitespace/malformed-date
variants before REST access. Cleanup marker removal remains in the dedicated lifecycle workflow.
Bounded percent-escape aliases of that prefix are rejected too, without normalizing outbound labels.
A label configured by `INCLUDE_TAGS` is an admission boundary and cannot be removed through this
tool. Other labels still require the target to pass the pre-mutation bounded-context access check.

## References

- [Official view/workbook tag removal](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_tag_from_view)
- [Official data-source tag removal](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_tag_from_data_source)
- [Official Python tag implementation](https://github.com/tableau/server-client-python/blob/master/tableauserverclient/server/endpoint/resource_tagger.py)
- [Search Content by Tag](search-content-by-tag.md)
