---
sidebar_position: 1
---

# Collections candidate tools

These five tools use the official
[Collections REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_collections.htm)
under `/api/-/collections`, with the authenticated session's site. This candidate has unit/mock
coverage; the target deployment's wire contract still requires an authorized live test.

## Tools and arguments

| Tool                      | Arguments                                                        | Result                                                    |
| ------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------- |
| `list-collections`        | Optional `pageNumber`, `pageSize`, `filter`, `sort`              | One metadata page with errors and pagination              |
| `create-collection`       | Required nonblank `name`; optional `description`                 | Direct CollectionModel with actual name and usable `luid` |
| `list-collection-items`   | Required collection LUID `collectionId`; optional list arguments | One page of member metadata                               |
| `add-collection-items`    | `collectionId`, nonempty `items`                                 | Membership affected count and partial errors              |
| `remove-collection-items` | `collectionId`, nonempty `items`                                 | Membership affected count and partial errors              |

A member input is `{ contentLuid, contentType, contentName? }`. `contentLuid` must be a Tableau
UUID. `contentType` must be nonblank and contain no control characters. OpenAPI supplies no
supported-type or casing enumeration. This candidate does not claim that arbitrary strings are
recognized Tableau types. Preserve a known `contentName`; its server-side necessity is unspecified.

Creation sends only `name` and optional `description`, without a wrapper. Product help says
collections are private by default; the actual deployment's default remains a live-test item.
Duplicate names can receive suffixes. Creation is not idempotent. If the response omits a usable
LUID, the tool warns that creation may have occurred; inspect the site before retrying.

## Paging, filters, and sort

Default page number is 1 and page size is 100. The positive page-number rule, 1000-item page-size
cap, and 1000-member batch cap are local candidate safeguards, not TAG schema limits.
`MAX_RESULT_LIMIT` and `MAX_RESULT_LIMITS` still constrain reachable offsets and returned items.

The exact
[TAG OpenAPI](https://help.tableau.com/current/api/rest_api/en-us/REST/TAG/index.html#tag/Collections-Methods)
query names are `page number`, `page size`, and `sort order`. The overview instead calls sorting
`sort`, and classic REST uses camelCase paging. This candidate uses the literal TAG names. Their
actual acceptance has not been verified. There is no automatic paging or fallback to private browser
APIs.

Filters use distinct-field `field:eq:value` expressions separated by commas. Only `eq` is exposed as
a conservative local restriction: the Collections-specific operator matrix is undocumented. Values
cannot contain `&` or commas. Timestamp values must be ISO 8601 date-times with a timezone.

| Endpoint    | Filter fields                                                                         | Sort fields                                                                     |
| ----------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Collections | `ownerLuid`, `visibility`, `createdTime`, `updatedTime`, `luid`, `siteId`, `favorite` | `visibility`, `createdTime`, `updatedTime`, `ownerName`, `name`, `modifiedTime` |
| Items       | `ownerLuid`, `title`, `createdTime`, `modifiedTime`, `luid`, `type`, `favorite`       | `position`, `createdTime`, `modifiedTime`, `ownerName`, `title`, `type`         |

Sort accepts one `field:asc` or `field:desc`. `favorite` filters accept `true`/`false`; visibility
accepts `public`/`private`. The docs describe the `siteId` filter as numeric but CollectionModel's
`siteId` as a LUID string; the candidate does not invent a conversion.

List results preserve `errors`, `moreItems`, `pagination`, and `totalCount`, plus `resultInfo`
describing the request, configured cap, and warnings. `completeness` remains `unverified`. Missing
or mismatched page metadata and contradictory totals are called out. Never treat a server-returned
first page as an advancing second page when metadata does not match.

## Permissions, bounds, and membership safety

All tools declare minimum Viewer role; Tableau still enforces the caller's endpoint permissions.
Membership changes are additionally owner-only, including for administrators. UUID identities in
collection details must match the authenticated site and user. When both collection owner and site
are numeric-string aliases, a separate, site-scoped
[collection permissions read](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_collection_permissions)
must return the requested collection LUID and the authenticated user's owner LUID. No alias/name
comparison or numeric-to-UUID conversion is used. Missing/mixed identities and UUID mismatches fail
closed without that fallback.

Owner-read sessions finish before the mutation session opens. The mutation session must match the
verified server origin, site and user, and collection details must retain the same raw owner/site
identities. The proof is used only within that operation. A missing signed-in user LUID can be
resolved only through the same-site current-session API. No owner/user/site argument is accepted.

Both listing tools refuse every configured bounded-content context. The official item `content`
model declares numeric internal `id`/`siteId`, `contentType`, `title`, and `syncToken`, but no
content LUID. Numeric IDs and syncToken cannot safely be used for LUID-based resource checks.

Before a membership change, every `workbook`, `view`, and `datasource` reference passes its existing
resource access checker. Other type strings, including flow/project and unknown casing, are refused
when any content restrictions apply. This conservative policy avoids expanding the flow feature's
OAuth scope surface. Unrestricted requests leave type acceptance to Tableau. Empty container
creation does not submit content and is allowed under bounds.

Both membership operations use POST (`items/batchCreate` and `items/batchDelete`). Removal changes
references only; it never deletes the underlying workbook, view, datasource, or other content. No
collection deletion, sharing, ownership transfer, or permission changes are implemented.

HTTP 200 can contain item-level failures. The result preserves the raw affected count and errors,
with `status` set to `completed`, `partial-failure`, or `unverified`. A count equal to the requested
item count with no errors establishes reported completion; an absent, invalid, or lower count does
not. No partial batch is retried automatically.

## Response privacy

These operations suppress raw REST request/response notifications only for their own calls and
nested content/config probes. Normal tool invocation logging, global notification levels, masking,
authentication, route guards, site/request override rules, and other tools are unchanged.
Site-setting lookups use the existing parser, merger, and cache with the same request identity and
context.

Collections responses are locally validated even when the server omits a JSON Content-Type. Schema
failures return a curated error without raw response contents, original messages, or retained
causes. Rejected member and owner checks likewise return curated messages. A malformed write
response explicitly warns that creation or membership changes may have occurred, and no retry is
performed.

The shared resource access checker can still write malformed upstream resource responses to its
operator-side stderr/file error logs. This inherited logging behavior is outside this candidate's
scope; those details are withheld from these tools' returned results and MCP notifications.

## Versions and scopes

The capability gate reads target-specific server information. Known Tableau Cloud pod hostnames
(`*.online.tableau.com`) require actual REST API 3.28+ (February 2026 release). Other deployments
require a parseable Server product version 2026.2+ and actual REST 3.29+, matching the
[version table](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_versions.htm).
Unknown/development/older versions fail closed. The SDK's global default version is unchanged.
Collections may be disabled by site settings independently of version; permission/endpoint failures
are not mislabeled as version failures.

- List: MCP `tableau:mcp:collections:read`; API `tableau:collections:read`, plus existing
  site-settings scope
- Create: MCP `tableau:mcp:collections:create`; API `tableau:collections:create`
- Membership: MCP `tableau:mcp:collections:update`; API `tableau:collections:read` and
  `tableau:collections:update`, plus `tableau:permissions:read` for numeric-identity verification
  and existing supported resource-checker scopes in OAuth discovery

List runtime JWTs request only `tableau:collections:read`; config probes request their existing
site-settings scope in a separate call. Membership runtime JWTs request the read/update pair; the
numeric-identity proof requests only permissions-read in a completed, separate session before the
membership session. Resource checks obtain their existing minimum scopes separately. No
source-content delete or permission-update scope is added.

## Live checks still required

Verify paging/sort wire spellings, accepted contentType casing, contentName necessity, collection
response media type/private default, shared-read permission semantics, and item-level errors on the
actual deployment. Begin with read-only checks. Any create/add/remove smoke test needs explicit
approval naming disposable collection/content targets. Mock tests do not establish live
availability.
