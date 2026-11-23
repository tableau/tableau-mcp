---
sidebar_position: 3
---

# Validate Workbook Draft

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Checks workbook XML for problems before you apply it to the open workbook with [`apply-workbook`](../workbook/apply-workbook.md), so invalid content never reaches %product_name%. It first runs a local well-formedness check, and only when that passes does it ask the running %product_name% instance for its authoritative structural validation. The tool is read-only: it never modifies the open workbook.

## APIs called

This tool checks workbook content and acts on the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. It first runs a local check; only when that passes does it defer to the running %product_name% instance. That deeper check is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Checks the XML for well-formedness — unclosed tags, mismatched elements, and invalid entities are rejected. Validated in-process (not an API call). When this catches errors they are reported immediately and no further check runs.
- Asks the running %product_name% instance to validate the workbook document and returns its authoritative result. Runs only after the local check passes.
  - `POST /v<x>/workbook/document:validate` — validate the posted workbook document against the running %product_name% instance (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/validateWorkbookDocument)

## Required arguments

### `xml`

The workbook XML to check. Provide the full workbook document you intend to apply with [`apply-workbook`](../workbook/apply-workbook.md). Passed as a string.

#### Example

```json
{ "xml": "<?xml version='1.0'?><workbook><worksheets/></workbook>" }
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected). The session is only needed for the deeper structural check against the running instance; the local well-formedness check runs regardless.

#### Example

`"77700"`

## Notes and caveats

- **Offline falls back to the local check.** When no %product_name% instance is reachable, the tool returns the result of the local well-formedness check instead of failing, so a syntax problem is still surfaced without a live session.
- **The running instance's result is authoritative.** When the deeper check runs, its `isValid` verdict and `issues` supersede the local check — including structural problems the local well-formedness check cannot see, such as a dashboard zone that references a missing worksheet.

## Example results

### Well-formed workbook (validated against the running instance)

```json
{ "isValid": true, "issues": [] }
```

### Structural issues reported by the running instance

```json
{ "isValid": false, "issues": [{ "severity": "error", "message": "Dashboard zone references missing worksheet \"Missing Sheet\"" }] }
```

### Malformed XML (local check)

```text
Workbook structure has 1 error(s):

1. XML is not well-formed: unclosed tag: worksheets

Fix these errors before calling apply-workbook.
```

### Well-formed with no live session (local check)

```text
Workbook structure is well-formed.
```

## Related

- [`apply-workbook`](../workbook/apply-workbook.md) — applies workbook XML to the open workbook; run this check first so invalid content never reaches %product_name%.
