---
sidebar_position: 4
---

# Validate Worksheet Draft

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Checks that a worksheet's content is well-formed XML before you apply it. Run this preflight against the worksheet XML you have edited so that unclosed tags, mismatched elements, or invalid entities are caught locally — and reported with fix guidance — instead of being sent on to %product_name% by [`apply-worksheet`](../worksheet/apply-worksheet.md). This tool is read-only: it inspects the XML you pass and never touches an open workbook or the local filesystem.

## APIs called

This tool calls no API. It validates the worksheet content you supply entirely in-process on the MCP server: it does **not** contact the local **%product_name% %ecapi_name%** (no loopback route and no per-session bearer token) and does not call the Tableau Cloud or Server REST API. Because nothing is sent anywhere, there are no OAuth scopes and no %product_name% session is required.

- Checks that the supplied worksheet content is well-formed XML — unclosed tags, mismatched elements, and invalid entities are reported so they can be fixed before applying the worksheet. Validated in-process (not an %ecapi_name% call).

## Required arguments

### `xml`

The worksheet content to validate, passed directly as an XML string. The tool parses it and returns either a "well-formed" confirmation or a numbered list of the well-formedness errors it found, each with guidance to fix the XML before calling [`apply-worksheet`](../worksheet/apply-worksheet.md). There is no `session` argument — validation runs locally and is not tied to any open %product_name% instance.

:::note[Empty input]
An empty or whitespace-only string is treated as well-formed: it is checked as an empty element, so it does not by itself produce an error.
:::

#### Example

```json
{ "xml": "<worksheet name=\"Sheet1\"><table/></worksheet>" }
```

## Example results

### Well-formed content

```json
{
  "message": "Worksheet structure is well-formed."
}
```

### Malformed content

```json
{
  "isError": true,
  "message": "Worksheet structure has 1 error(s):\n\n1. XML is not well-formed: unclosed tag: table\n\nFix these errors before calling apply-worksheet."
}
```

## Related

- [`apply-worksheet`](../worksheet/apply-worksheet.md) — applies a worksheet back to the open %product_name% workbook; run this check first so malformed XML never reaches it.
- `get-xml` — reads a worksheet's structure to produce the XML you edit and then validate here.
