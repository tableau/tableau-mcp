## Worked example

The response fields are:

- `data`: the projects on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of projects available for pagination, never more than a server cap.
  Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides projects:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.
