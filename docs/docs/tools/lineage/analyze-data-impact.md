# Analyze Data Impact

Find downstream dependency exposure before changing a column, calculation, Prep step/field or flow.
This tool shares the identities, API requirements and limits of
[Get Data Lineage](get-data-lineage.md). It never applies the change or runs a flow.

```json
{
  "source": { "type": "column", "table": "orders", "name": "sales_amount" },
  "change": "delete",
  "includePrepDetails": true,
  "maxDepth": 8
}
```

To analyze a field at a specific Prep step, use:

```json
{
  "source": {
    "type": "prep-field",
    "flowLuid": "11111111-1111-4111-8111-111111111111",
    "stepId": "the-document-step-id",
    "name": "Gross Sales"
  },
  "change": "calculation-change"
}
```

`change` is `delete`, `rename`, `type-change`, `calculation-change` or `step-change`. It records the
proposed operation; the analysis does not simulate values, infer native result types or prove that a
particular calculation will break. Traversal is always downstream.

The response includes the lineage graph plus an `impacts` list. Each entry identifies a target and
one strongest known path (`nodeIds` and `edgeIds`), then prefers a shorter path of the same
certainty:

| Classification | Meaning                                                                          |
| -------------- | -------------------------------------------------------------------------------- |
| `direct`       | One authoritative reference or supported static field mapping                    |
| `indirect`     | A chain of confirmed reference/mapping edges                                     |
| `possible`     | A transitive catalog rollup or unverified cross-API field binding is on the path |
| `unknown`      | An unresolved static mapping or unsupported dependency prevents a confirmed path |

A transitive API result remains `possible` even when represented by one graph edge. Terminal
container membership cannot propagate to unrelated fields or sheets. A known output-step membership
can be direct while the route through its unverified catalog output fields remains possible.

Read `resolution`, `coverage`, `warnings`, `limitations` and any Prep field-analysis gaps before
answering. Permission-filtered assets are omitted from nodes and paths. A failed optional document
request does not discard usable catalog lineage. Missing metadata and bounded/partial results must
never be described as proof of zero impact. The response contains a representative evidence path per
target, not every possible path or an estimate of business severity.
