---
sidebar_position: 3
---

# Add Content Tags

`add-content-tags` adds labels to one workbook, published view or published data source. It uses
Tableau's additive tag endpoint, preserving every existing tag. Exact duplicate labels in one
request are deduplicated; Tableau ignores labels already present. Labels retain their Unicode, case
and whitespace, with no normalization.

## Arguments

- `resourceType`: `workbook`, `view` or `datasource`
- `resourceId`: the content's Tableau LUID (UUID format)
- `tagLabels`: a non-empty list of decoded labels, such as `["Quarterly review", "売上"]`

Example:

```json
{
  "resourceType": "workbook",
  "resourceId": "22222222-2222-4222-8222-222222222222",
  "tagLabels": ["Quarterly review", "売上", "Sales #1"]
}
```

The response identifies the resource and the deduplicated `addedTagLabels` acknowledged by Tableau.
It is not a complete tag snapshot and does not distinguish new labels from already-present labels.
Use the content read tools to inspect the resulting tags when needed.

## Deployment and permissions

The tag REST endpoints are available from API 1.0. The operation-specific JWT scopes were added in
API 3.27 (Tableau Cloud December 2025 / Server 2025.3). Older PAT/session support is separate from
JWT-scope availability; this tool does not fall back to broader JWT scopes.

The tool is registered at the Viewer role floor and is not an administrator-only lifecycle tool.
Tableau still enforces the caller's actual content permissions. The add methods document Read
permission for non-administrators; the product tagging UI has additional role restrictions.

OAuth MCP authorization requires the dedicated `tableau:mcp:content:tags:write` grant. Content-read
or lifecycle-delete grants alone do not authorize generic tag changes. Ensure deployed clients
request this grant when OAuth scope enforcement is enabled.

Each mutation requests only the selected resource's tag scope:

- Workbook: `tableau:workbook_tags:update`
- View: `tableau:view_tags:update`
- Data source: `tableau:datasource_tags:update`

OAuth scope discovery advertises the union for all three resource types and the read scopes used by
bounded-context checks (`tableau:content:read`, `tableau:mcp_site_settings:read`). A bounded-context
lookup uses a separate read-only REST session. Configure the existing authentication and
[tool scoping](../../configuration/mcp-config/tool-scoping.md) settings; no credentials or new
permission grants are created by these tools. Every target is checked against the configured
resource, project and tag bounds before mutation. A rejected request does not change tags.

## Tool limits and lifecycle safety

These are defensive **MCP tool limits**, not published Tableau API limits:

- 1–50 submitted labels per call, before exact deduplication
- At most 256 UTF-16 code units per label
- No empty/whitespace-only labels, ASCII controls or invalid Unicode

The reviewed REST help and XSD specify no numeric tag-length/count limit or general character
whitelist. Special punctuation and Unicode labels are preserved in JSON.

The entire `pending-deletion` prefix is reserved, including dated, malformed-date, mixed-case,
surrounding-whitespace and bounded percent-escape aliases (for example `%70ending-deletion`).
Aliases are checked only for rejection; outbound labels are never decoded or normalized. Other
ordinary percent labels retain their exact text. A request mixing ordinary and reserved labels is
rejected in full before any REST lookup or mutation. Use the dedicated content lifecycle workflow to
manage cleanup markers; generic tagging cannot manufacture deletion evidence or remove safeguards.

Tag changes can affect future access when `INCLUDE_TAGS` is configured. Adding a matching tag cannot
admit an already out-of-bounds target because the access check occurs first.

Access-check probes and mutation sessions disable raw REST payload notifications, including at the
default debug notification level. The normal tool invocation logging and telemetry remain active;
rejected resource metadata and full existing tag collections cannot bypass result narrowing through
debug notifications. Malformed response errors are curated without raw payloads. A malformed
mutation response reports an uncertain outcome: the write may have applied, so inspect the tags
before retrying. Mutation response envelopes are explicitly checked even when the server omits or
misreports its response Content-Type.

## References

- [Official workbook and view tag methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_view)
- [Official data-source tag methods](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source)
- [Official 3.29 XSD](https://help.tableau.com/samples/en-us/rest_api/ts-api_3_29.xsd)
- [Remove Content Tag](remove-content-tag.md)
- [Search Content by Tag](search-content-by-tag.md)
