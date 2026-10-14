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
| `paramWireRegistry.ts`       | Optional `$TABLEAU_COMMANDS_REGISTRY_DIR` command/param wire-name registry                        |
| `toolUtils.ts`               | Error helpers shared with the tool layer (`isRouteMissing`, …)                                    |
| `mockExternalApiServer.ts`   | Real-HTTP mock of the /v0 surface for tests                                                       |

## Adding awareness of a new API method

1. `types.ts` — add the route to `EXTERNAL_API_ROUTES` (plus a route-builder function if it has an
   `{id}` segment) and a zod schema for its response.
2. `externalApiToolExecutor.ts` — add one endpoint method: route + schema through an
   `ExternalApiHttp` primitive (`getJson`, `getXml`, `postXmlEnvelope`, …).
3. `mockExternalApiServer.ts` — add the route's handler branch.
4. `externalApiContract.test.ts` — keep the compatibility fixture for the historical route surface
   and add a separate exact compiled capture when a newer producer contract is intentionally
   narrower. Recapture the relevant fixture from the producer before release.

To expose it as an MCP tool, add a tool file under `src/tools/desktop/` and register it in
`toolName.ts` + `tools.ts` (and the default profile allowlist in `server.desktop.ts` if it should
ship in the default surface).

## OpenAPI fixture scopes

`__fixtures__/externalClientApi-openapi.json` is the 0.2.20 compatibility snapshot. It retains the
broader historical route inventory, including an archival Qt-only dialog shape. Runtime dialog
schemas are tested only against the current producer capture; other compatibility tests retain the
historical fixture.

`__fixtures__/nativeDialogs-openapi.json` is the exact compiled 0.2.23 producer capture for the
current dialogs contract. It is authoritative for session/revision identity, capability descriptors,
closed invocation variants, safe request status, and the existing dialog endpoints. It does not
replace the compatibility snapshot: the current producer capture intentionally does not carry every
historical route and component. The contract suite tests each fixture only for its stated scope.

## Current dialog contract

Both dialog tools require External Client API 0.2.23 or later. Qt, file, print, and color dialogs
share a stable `sessionId`/`revision` identity. Every action supplies the observed identity and an
opaque `requestId`, supplied by the caller or generated once by MCP. The POST returns a direct 200
response with one of six outcomes: `dispatched-pending`, `completed`, `canceled`, `failed`,
`expired`, or `indeterminate`. Read `status.state`, `status.effect`, and any `status.code` to
interpret completion. Pending effects are checked by a later dialogs read. Never replay an
invocation, and never log or echo a selected path, printer destination, or color value.

The MCP dialogs tool adds invocation syntax as each capability's `input.fields`. This metadata comes
from the consumer's closed action contract; it describes names, types, and required inputs, while
the producer's capability supplies the current constraints. It is not a selected value or an
additional field in the producer OpenAPI response. Both transport and tool deadline errors retain
generated request IDs for status correlation without replay. Session identities are never discarded
to invoke a legacy tuple-only action.
