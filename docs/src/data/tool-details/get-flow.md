## Response-size guidance

| Question shape                              | Recommended arguments                               |
| ------------------------------------------- | --------------------------------------------------- |
| "What is this flow?" (just metadata)        | `includeConnections: false, includeFlowRuns: false` |
| "What does this flow read from?"            | `includeFlowRuns: false` (keep `connections`)       |
| "Did the latest run succeed?" (status only) | `flowRunLimit: 1` (or 3)                            |
| "Show me the run history"                   | `flowRunLimit: <n>` up to 100                       |

## Partial failure (`mcp.warnings`)

The primary
[Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
call is atomic; if it fails, the tool returns an error.

The optional `connections` and `flowRuns` sidecars are best-effort. If either of them fails (for
example, the user lacks permission, the server is too old, or the request times out) the tool will
still return the flow's primary metadata and surface a structured warning instead of failing the
whole tool call. The tool can emit three warning types:

### `SIDECAR_FETCH_FAILED`

### `VERSION_GATE_SKIPPED`

## Failure reasons (`mcp.failureSummary`)

On Tableau REST API >= 3.30, a `Failed` run carries `failureReason: { available, message }` giving the
cause of the failure. It is readable by any caller who can see the run — it comes from the flow's
output-step errors, not the admin-only background job.

When at least one returned run carries a reason, the tool also emits `mcp.failureSummary`, which
groups those failures by reported message and availability:

- `failedRunCount` — `Failed` runs among the returned runs.
- `failedFlowCount` — **distinct** flows with a failure. Here that is `1` (or `0` if Tableau omits
  `flowId` on the runs), since this tool returns runs for a single flow; the field exists so the shape
  matches [List Flow Runs](./list-flow-runs.md#mcpfailuresummary) exactly.
- `reasons` — one entry per distinct `{ message, available }` pair, largest first, as
  `{ message, available, runCount, flowIds }`. A group is not always a single root cause: several
  distinct underlying errors can map to the same short localized message, and the REST API does not
  expose the underlying error identifier.
- `available: false` means Tableau could not determine the cause and `message` is a generic
  placeholder. Do not present it as a diagnosis. This tool emits no run-history deep link of its own —
  append `/runHistory` to the `webpageUrl` already in the response to open the flow's run history and
  read the error in the Tableau UI.

Because the counts cover all `Failed` runs while `reasons` covers only reason-bearing ones,
`sum(reasons[].runCount)` can be less than `failedRunCount`. On servers below REST API 3.30 both
`failureReason` and `mcp.failureSummary` are absent.

```json
{
  "mcp": {
    "failureSummary": {
      "failedRunCount": 1,
      "failedFlowCount": 1,
      "reasons": [
        {
          "message": "Table \"orders\" was not found.",
          "available": true,
          "runCount": 1,
          "flowIds": ["d00700fe-28a0-4ece-a7af-5543ddf38a82"]
        }
      ]
    }
  }
}
```

## Limitations

A few things this tool deliberately does **not** expose in the current version:

- **Failure reasons need REST API >= 3.30, and only cover `Failed` runs.** On older servers
  `failureReason` and [`mcp.failureSummary`](#failure-reasons-mcpfailuresummary) are simply omitted and
  the response is unchanged. Even on 3.30+, there is no reason for a `Cancelled` run and nothing
  explaining why a run is slow or stuck `InProgress`.
- **A reason is a short message, not a log.** `failureReason.message` is a short localized cause. The
  full underlying job error is not surfaced by the public Tableau REST API and reading it requires
  site-administrator access. To investigate further, inspect the run in the Tableau Server / Cloud UI.
  `mcp.failureSummary`'s counts inherit this limit: they describe the returned runs only, so never
  report them as the flow's total or historical failure rate.
