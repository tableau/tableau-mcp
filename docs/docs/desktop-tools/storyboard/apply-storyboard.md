---
sidebar_position: 4
---

# Apply Storyboard

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies an edited storyboard document to the workbook open in %product_name%, replacing that one storyboard and leaving the workbook's other sheets intact. The edited document is always read from a cached file on the local machine — there is no inline option — and the storyboard must already exist: this tool updates one in place and never creates one. When that cache file carries source metadata, a freshness check rejects the apply if this storyboard has changed in %product_name% since the read (_available September 2026 and later_).

:::warning[Destructive]
This tool is not read-only and not idempotent. It replaces a storyboard in the live %product_name% session with the document you supply.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Reads the edited storyboard document from the cached file path you pass, and checks that the file belongs to the resolved %product_name% session. Local filesystem; no API call.
- Validates the document before anything is sent to %product_name% — validated in-process (not an API call). Blocking problems stop the apply so a bad document never reaches %product_name%; the remaining findings ride along as preflight warnings and are counted in the result.
- Checks that `storyboardName` agrees with the name carried inside the document, then resolves that name to a storyboard that is actually open. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/storyboards` — list the storyboards in the open workbook so the name can be matched to one. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)
  - `GET /v<x>/workbook/storyboards/{id}/document` — read the live storyboard to validate the edit against it and, when the cache file carries source metadata, for the freshness check. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/getStoryboardDocument)
- Replaces that single storyboard with the document you supplied, leaving the workbook's other sheets untouched.
  - `POST /v<x>/workbook/storyboards/{id}/document` — replace one storyboard from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/applyStoryboardDocument)
- Brings the updated storyboard to the foreground afterwards. Best-effort by construction: the apply has already landed, so navigation that does not take is recorded in the logs and never turns a successful apply into a failure.
  - `GET /v<x>/workbook/document` — re-read the workbook to confirm the target name before navigating. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - `GET /v<x>/workbook` — read the sheet inventory to resolve the storyboard id for navigation. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbook)
  - `POST /v<x>/workbook:goToSheet` — bring the updated storyboard to the foreground. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/goToSheet)

## Required arguments

### `storyboardName`

The name of the storyboard to update. It is first checked against the name carried in the cached document itself, compared case-sensitively after trimming and Unicode normalization. If the two disagree, the tool refuses before touching %product_name% and names both spellings, so you can retry with the document's name or correct the document to match.

Once that check passes, the same name is matched against the storyboards in the open workbook to find the one to replace.

#### Example

```json
{ "storyboardName": "QBR Story" }
```

:::note[Storyboards are serialized as dashboards]
A storyboard is stored as a `<dashboard>` element carrying `type="storyboard"`, so the name the tool checks against is that element's `name` attribute, and some messages about the document refer to dashboards. A cached file that holds a whole `<workbook>` document rather than a single storyboard element is rejected, with guidance on pulling out just the element you meant to edit.
:::

:::note[No storyboard by that name]
If the name does not resolve to exactly one storyboard in the open workbook, the tool reports that there is nothing to update and reminds you that it updates an existing storyboard in place rather than creating one. Verify the name, and that the storyboard exists in the workbook that is open.
:::

## Optional arguments

### `storyboardFile`

Absolute path to the cached storyboard document on the local machine. The schema marks it optional, but a call without a usable path is refused — there is no inline alternative, so **in practice a non-empty path is required**. The file must already exist; a missing path and a path that points nowhere both come back as errors telling you to supply an existing cached storyboard path.

#### Cache session guard

The file must carry a companion fingerprint matching the resolved %product_name% session. A cache produced by a different (or restarted) %product_name% instance is rejected before anything is applied, preventing cross-instance cache bleed.

:::note
The path must be a regular file inside the Desktop cache directory. A path outside that directory, or anything that is not a regular file, is refused as a security error and the apply does not run.
:::

#### Example

```json
{ "storyboardName": "QBR Story", "storyboardFile": "/Users/me/.tableau-mcp/cache/storyboard-abc123.xml" }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

## Notes and caveats

- **Last writer wins.** When the cache file carries no source metadata, the apply carries no precondition check, so it overwrites an edit someone else made to the same storyboard in the meantime. When it does, the apply is refused if the storyboard changed since the read. Renaming the target storyboard while the apply is in flight makes the apply fail instead.
- **The apply is not re-verified.** A storyboard apply has no structural readback, so the result carries an honest verification receipt that lists the applied structure as unverified. %product_name% accepting the document and the preflight warning count are observed; whether the storyboard kept the structure you intended is not. Read the storyboard back if you need to confirm it.
- **Rejections from %product_name% surface as failures.** When %product_name% takes the request but reports that the document load itself failed, the tool reports that as an error rather than a success message.

## Example result

```json
{
  "message": "Successfully applied storyboard update for \"QBR Story\". The storyboard has been updated.\n\nHOST VERIFICATION — unverified: preflight clean · apply completed · full dashboard intent NOT re-verified. Treat dashboard state as unconfirmed until read back; do not report problems without host evidence.",
  "nextAction": {
    "kind": "done",
    "label": "Storyboard apply accepted — structure not re-read",
    "receipt": {
      "did": [
        "Desktop accepted the storyboard XML apply for \"QBR Story\"",
        "preflight validation returned 0 warning(s)"
      ],
      "didNot": [],
      "unverified": [
        "whether the applied storyboard retained its intended structure — no structural readback ran (storyboard applies have none)"
      ]
    }
  }
}
```

## Related

- [`add-storyboard`](./add-storyboard.md) — adds a blank storyboard when the target does not exist yet.
- `get-xml` — writes the storyboard document to a cache file you can edit and then apply.
- [`write-cached-xml`](../cache/write-cached-xml.md) — splices an edit back into a cached document without retyping it.
