---
sidebar_position: 2
---

# Read an Authoring Guide

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Reads one module from the authoring-guidance library, or a single section of it, and returns the markdown. The library is the markdown under [`TABLEAU_EXPERTISE_DIR`](../../configuration/mcp-config/env-vars.md#tableau_expertise_dir); with no root set, the library is empty. Pass a URI from [`search-expertise`](./search-expertise.md). The read runs in-process, does not use a %product_name% session, and does not change the library.

## APIs called

This tool does not call %product_name%. It reads that authoring-guidance library in-process. It does not contact a running %product_name% instance or the Tableau Cloud or Server REST API, so there is no loopback route, no per-session bearer token, no OAuth scope, and no session.

- Returns the markdown for one library module, or for one section of it when `uri` has a `#section` fragment. Done in-process (not an API call).

## Required arguments

### `uri`

The module to read. A string of the form `expertise://tableau/{slug}`, with `#section` added to read one section. `{slug}` is the module's path inside the library, with `/` between folders and without a `.md` suffix — for example `strategy/viz-design/chart-selection` or `tactics/viz/filters`.

With no fragment, the tool returns the whole module as markdown. There is no 6,144-byte cap on this read; that cap applies only to `topHitBody` from [`search-expertise`](./search-expertise.md). When the slug names a module, a trailing `#` with nothing after it also returns the whole module.

#### Sections

With `#section`, the tool returns that heading and the lines under it, through the line before the next heading of the same level or a higher level. A heading nested under the one you named stays in the result. For a module that contains `# Guide`, then `## First` (with a `### Nested` under it), then `## Second`, the fragment `#first` returns from `## First` through the nested body and stops before `## Second`.

The fragment matches a heading slug or the heading's own text. A heading slug is the heading text in lower case, with spaces turned into hyphens and with every character other than letters, digits, spaces, and hyphens removed. `## Best Practices` is `best-practices`, and `## When to Use` is `when-to-use`. Spaces in the heading text can be percent-encoded: `#When%20To%20Use` matches `## When To Use`. A percent-encoding that is not valid is matched as the raw text after `#`, so `#a%b` matches a heading `ab`.

The fragment can name a heading deeper than level 2. `sections` on a [`search-expertise`](./search-expertise.md) hit lists only level-1 and level-2 slugs, and that is the list this tool names when a fragment matches nothing. Headings written inside a fenced code block are not sections.

#### Example

```json
{ "uri": "expertise://tableau/strategy/viz-design/chart-selection" }
```

```json
{ "uri": "expertise://tableau/guide#first" }
```

:::note[Unknown URI]
When the URI does not name a module, the tool refuses the call and tells you to use [`search-expertise`](./search-expertise.md). For `expertise://tableau/nonexistent` the text is:

```text
Resource not found: expertise://tableau/nonexistent

Use search-expertise to find available resource URIs.
```

The same text, with the URI you passed, is returned when the URI does not start with `expertise://tableau/`, and when the slug is empty, starts with `/`, contains `..` or a backslash, includes an empty path segment, or includes a hidden segment whose name starts with `.`. A `#section` on a module that is not in the library is this refusal as well, because there are no sections to name.
:::

:::note[Unknown section]
When the module is in the library and the fragment names no heading, the tool names the sections that module actually has: the slugs of its level-1 and level-2 headings, in document order. The quoted section is the text after `#`, as you passed it. For a module whose headings are `# Guide`, `## First`, `### Nested`, and `## Second`, `expertise://tableau/guide#missing` is refused with:

```text
No section "missing" in expertise://tableau/guide.

Sections: guide, first, second
```

`nested` is a valid fragment for `### Nested`, and it is absent from that list because the list stops at level 2. If the module has no level-1 or level-2 heading, the refusal is the unknown-URI text instead.
:::

## Example results

The tool returns the markdown as text.

### Whole module (`uri`: "expertise://tableau/strategy/viz-design/chart-selection")

The tool returns the module's markdown as text. A module whose text is the sample below is returned as that sample.

```markdown
# Chart Selection

Choose the right chart type for your data.
```

### One section (`uri`: "expertise://tableau/guide#first")

For the module described under `uri`, the result runs from `## First` through the nested body.

```markdown
## First
first body
### Nested
nested body
```

### Heading text (`uri`: "expertise://tableau/guide#When%20To%20Use")

For a module whose section heading is `## When To Use` and whose section body is `use it here`, the result is that section.

```markdown
## When To Use
use it here
```

## Related

- [`search-expertise`](./search-expertise.md) — find module URIs, and the section slugs to append as `#section`.
