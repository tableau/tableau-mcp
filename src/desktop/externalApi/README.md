# External Client API layer

All normal Tableau Desktop API traffic lives here. Desktop is reached only through the External
Client API ("Athena V0"), a loopback HTTP host discovered via per-instance `<pid>.json` files.

| File                         | Role                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `types.ts`                   | Route constants, `{id}` route builders, and zod schemas for every payload                         |
| `externalApiHttp.ts`         | Generic HTTP mechanics: auth, timeouts, problem mapping, 202→poll. No endpoint names              |
| `externalApiToolExecutor.ts` | The one tool executor: instance discovery/pinning, 401 rescan, and **every tool endpoint method** |
| `executorTypes.ts`           | Shared executor types (`ExecuteCommand*`, `WorkbookDocument`, …)                                  |
| `discovery.ts`               | Discovery-file scanning (`TABLEAU_EXTERNAL_API_DISCOVERY_DIR` override)                           |
| `toolUtils.ts`               | Error helpers shared with the tool layer (`isRouteMissing`, …)                                    |
| `mockExternalApiServer.ts`   | Real-HTTP mock of the /v0 surface for tests                                                       |

## Adding awareness of a new API method

1. `types.ts` — add the route to `EXTERNAL_API_ROUTES` (plus a route-builder function if it has an
   `{id}` segment) and a zod schema for its response.
2. `externalApiToolExecutor.ts` — add one endpoint method: route + schema through an
   `ExternalApiHttp` primitive (`getJson`, `getXml`, `postXmlEnvelope`, …).
3. `mockExternalApiServer.ts` — add the route's handler branch.
4. `externalApiContract.test.ts` — the captured `__fixtures__/externalClientApi-openapi.json` must
   contain the route; recapture from a live build if it is new to the spec.

To expose it as an MCP tool, add a tool file under `src/tools/desktop/` and register it in
`toolName.ts` + `tools.ts` (and the default profile allowlist in `server.desktop.ts` if it should
ship in the default surface).

## Native dialog actions

`get-active-dialogs` and `invoke-dialog-action` share the session-safe dialog contract introduced in
API 0.2.26. Later builds add file, color, and print providers. Use the capabilities returned for the
current dialog rather than assuming provider support from the platform or API version. Preparing,
suspended, and closing panels are blockers; they do not authorize an action.

Copy `objectName`, `title`, `className`, `sessionId`, and `revision` exactly. Generate one
`requestId` for a logical action. If its outcome is uncertain, poll `recentActions` in the same
Desktop session; replay only the identical request with that ID. A changed selection is a new
logical action and must wait until the previous request is settled and fresh capabilities are
available. Never replay across a Desktop restart or session change.

- File actions use the advertised filter IDs and selection bounds. Set `overwriteConfirmed` only for
  an overwrite the user authorized, even when `overwriteConfirmationRequired` is false: the final
  destination can change after extension handling.
- Color actions use integer channels from 0 through 255; include alpha only when supported.
- Print actions use the advertised printer IDs, ranges, sheet scopes, page/copy bounds, and support
  flags. The producer accepts signed 32-bit page/copy integers; dynamic limits may be narrower.
  Supply `outputPath` only when print-to-file is supported and requested.

Inspect `outcome`, `status.state`, `status.effect`, and any `status.code` even on HTTP 200. Pending,
failed, canceled, expired, and indeterminate results are not successful writes. An empty `dialogs`
array proves no blockers only when `uiSnapshotAvailable` is true. `file-choice-returned`,
`color-returned`, `native-panel-closed`, and `print-prepared` describe dialog progress, not
completion of the originating save, export, formatting, or print operation. Verify that operation
and its resulting workbook or output separately before reporting success.
