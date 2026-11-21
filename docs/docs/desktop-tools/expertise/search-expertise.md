---
sidebar_position: 1
---

# Search Expertise

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Searches the authoring-guidance library by concept — chart choice, calculation patterns, workbook structure, and dashboard layout — and returns the closest modules as JSON. The library is the markdown under [`TABLEAU_EXPERTISE_DIR`](../../configuration/mcp-config/env-vars.md#tableau_expertise_dir); with no root set, the library is empty. The search runs in-process, does not use a %product_name% session, and does not change the library. When the result includes `topHitBody`, that text is the top module and no follow-up read is needed, unless the text was shortened to the 6,144-byte cap described under `query`. Otherwise read the top hit's `mustReadUri` with [`read-expertise-resource`](./read-expertise-resource.md).

## APIs called

This tool does not call %product_name%. It searches that authoring-guidance library in-process. It does not contact a running %product_name% instance or the Tableau Cloud or Server REST API, so there is no loopback route, no per-session bearer token, no OAuth scope, and no session.

- Ranks modules in the authoring-guidance library against `query` and returns the closest matches as JSON. Done in-process (not an API call).

## Required arguments

### `query`

Task or topic to search for, as a string. For example, `top 10 by category`.

#### How the query is matched

Ranking uses each module's title, its tags, the line labeled "Relevant user prompts/search terms", the "When to Use" section, and the module slug. The rest of the module body is not a ranked field.

A word counts when it is longer than two characters. Common words are dropped, so a query made only of those words, such as `use the`, is matched as a whole phrase, and that hit's `match` is `whole-string`. Any other query is matched word by word, and `match` is `keyword`. Modules that share more of the query's words rank higher, a word that also appears in the title ranks a little higher, and a tie breaks by slug. A word of five or more letters that ends in `s`, but not `ss` or `es`, is matched in the singular, so `charts` matches `chart`.

A leading `'`, `!`, `^`, or `=`, a trailing `$`, and a `|` or `"` anywhere in the query are treated as plain text. A query that is only those characters, such as `!!!`, matches nothing.

A blank query matches nothing.

#### What a hit contains

Hits are best first. Every hit has `uri`, `slug`, `title`, `score`, `snippet`, and `match`. `uri` has the form `expertise://tableau/{slug}`. `score` is a number from 0 to 1, and a higher score is closer. `snippet` is a short excerpt, not the module.

The first hit also has:

- `mustReadUri`, the same value as that hit's `uri`
- `instruction`, the text `snippet is not the module — read this URI before authoring; append #<section> from sections to read one section instead of the whole module`
- `sections`, the slugs of that module's level-1 and level-2 headings (`#` and `##`), in document order. A heading slug is the heading text in lower case, with spaces turned into hyphens and with every character other than letters, digits, spaces, and hyphens removed, so `## When to Use` is `when-to-use`

Later hits omit those three fields. Append `#` and one of `sections` when you call [`read-expertise-resource`](./read-expertise-resource.md) and you want one section instead of the whole module. A fragment can also name a deeper heading; `sections` lists only the first two levels.

#### When the module text is included

`topHitBody` is the top module's markdown. It is included when that hit is the only candidate, or when its score is at least 0.15 above the next candidate. The comparison still scores a runner-up when `limit` is 1, so asking for one hit cannot hide a close second. When `topHitBody` is present and was not shortened, you do not need to read that module again.

If the module is longer than 6,144 bytes, `topHitBody` is cut so the value stays within 6,144 bytes and ends with a blank line and `[TRUNCATED: body exceeds 6144-byte cap]`. Call [`read-expertise-resource`](./read-expertise-resource.md) on `mustReadUri` for the rest of a truncated module. That read is not subject to the 6,144-byte cap.

When the top two candidates are closer than 0.15, `topHitBody` is omitted. Read `mustReadUri`.

When nothing in the library scores as a hit, `hits` is empty. `nearestMatches` then holds the nearest modules, each with `match` set to `nearest`, and the result includes this `note`:

`hits is empty; nearestMatches contains the nearest keyword results, not exact hits.`

The first nearest match carries `mustReadUri`, `instruction`, and `sections`. Later nearest matches omit those three fields. How many nearest matches come back is described under `limit`.

When the library has no modules, or the query is blank or only operator characters, the result is an empty `hits` array, with no `nearestMatches` and no `note`.

#### Example

```json
{ "query": "pie chart of countries" }
```

:::note[Names starting with an underscore]
A module whose file name starts with `_` is navigation material and is left out of search results.
:::

## Optional arguments

### `limit`

Maximum number of hits to return. A positive integer (1 or greater). Defaults to `5`.

This caps `hits` only. The decision to include `topHitBody` still compares the top candidate with a runner-up, even when `limit` is 1. See `query`.

When there are no keyword hits, `nearestMatches` is capped at 5 modules, and at `limit` when `limit` is 3, 4, or 5. `limit` 1 or 2 still caps the list at 3. `limit` 10 still caps it at 5. The list is shorter when fewer modules are near the query.

#### Example

```json
{ "limit": 3 }
```

## Example results

The tool returns this JSON as pretty-printed text. Every hit includes `score`, a number from 0 to 1 (higher is closer). The first example shows one. The later examples leave it out.

### No module text (`query`: "pie chart of countries", `limit`: 3)

`topHitBody` is omitted when the top hit is not confident, so read `mustReadUri`. The first hit below is a chart-selection match in that situation. Its `sections` list is the module's level-1 and level-2 heading slugs; the next example shows that field.

```json
{
  "hits": [
    {
      "uri": "expertise://tableau/strategy/viz-design/chart-selection",
      "slug": "strategy/viz-design/chart-selection",
      "title": "Chart Selection",
      "score": 0.9,
      "snippet": "Choose a chart from the analytical question.",
      "match": "keyword",
      "mustReadUri": "expertise://tableau/strategy/viz-design/chart-selection",
      "instruction": "snippet is not the module — read this URI before authoring; append #<section> from sections to read one section instead of the whole module"
    },
    {
      "uri": "expertise://tableau/tactics/viz/marks-and-encodings",
      "slug": "tactics/viz/marks-and-encodings",
      "title": "Marks and Encodings",
      "score": 0.88,
      "snippet": "Pick the mark type and encodings for each field.",
      "match": "keyword"
    }
  ]
}
```

### Module text included (`query`: "margin calculation", `limit`: 5)

When the library contains only this module, the top hit is confident and `topHitBody` is the module text. The headings `# Margin Calculation` and `## When to Use` produce the `sections` below.

```json
{
  "hits": [
    {
      "uri": "expertise://tableau/margin-calculation",
      "slug": "margin-calculation",
      "title": "Margin Calculation",
      "snippet": "Use this for margin calculations.",
      "match": "keyword",
      "mustReadUri": "expertise://tableau/margin-calculation",
      "instruction": "snippet is not the module — read this URI before authoring; append #<section> from sections to read one section instead of the whole module",
      "sections": ["margin-calculation", "when-to-use"]
    }
  ],
  "topHitBody": "# Margin Calculation\n- Relevant user prompts/search terms: margin calculation\n\n## When to Use\nUse this for margin calculations."
}
```

### Nothing matched (`query`: "zzzznotfound")

Searching that same one-module library for `zzzznotfound` produces no keyword hit. `hits` is empty, `note` is set, and the module is returned under `nearestMatches`.

```json
{
  "hits": [],
  "nearestMatches": [
    {
      "uri": "expertise://tableau/margin-calculation",
      "slug": "margin-calculation",
      "title": "Margin Calculation",
      "snippet": "Use this for margin calculations.",
      "match": "nearest",
      "mustReadUri": "expertise://tableau/margin-calculation",
      "instruction": "snippet is not the module — read this URI before authoring; append #<section> from sections to read one section instead of the whole module",
      "sections": ["margin-calculation", "when-to-use"]
    }
  ],
  "note": "hits is empty; nearestMatches contains the nearest keyword results, not exact hits."
}
```

## Related

- [`read-expertise-resource`](./read-expertise-resource.md) — read a module, or one section of it, from a URI this search returned.
