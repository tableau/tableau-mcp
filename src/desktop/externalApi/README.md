# External Client API layer

All normal Tableau Desktop API traffic lives here. Desktop is reached only through
the External Client API ("Athena V0"), a loopback HTTP host discovered via
per-instance `<pid>.json` files.

| File | Role |
| --- | --- |
| `types.ts` | Route constants, `{id}` route builders, and zod schemas for every payload |
| `externalApiHttp.ts` | Generic HTTP mechanics: auth, timeouts, problem mapping, 202→poll. No endpoint names |
| `externalApiToolExecutor.ts` | The one tool executor: instance discovery/pinning, 401 rescan, and **every tool endpoint method** |
| `executorTypes.ts` | Shared executor types (`ExecuteCommand*`, `WorkbookDocument`, …) |
| `discovery.ts` | Discovery-file scanning (`TABLEAU_EXTERNAL_API_DISCOVERY_DIR` override) |
| `paramWireRegistry.ts` | Optional `$TABLEAU_COMMANDS_REGISTRY_DIR` command/param wire-name registry |
| `toolUtils.ts` | Error helpers shared with the tool layer (`isRouteMissing`, …) |
| `mockExternalApiServer.ts` | Real-HTTP mock of the /v0 surface for tests |

## Adding awareness of a new API method

1. `types.ts` — add the route to `EXTERNAL_API_ROUTES` (plus a route-builder function
   if it has an `{id}` segment) and a zod schema for its response.
2. `externalApiToolExecutor.ts` — add one endpoint method: route + schema through an
   `ExternalApiHttp` primitive (`getJson`, `getXml`, `postXmlEnvelope`, …).
3. `mockExternalApiServer.ts` — add the route's handler branch.
4. `externalApiContract.test.ts` — the captured `__fixtures__/externalClientApi-openapi.json`
   must contain the route; recapture from a live build if it is new to the spec.

To expose it as an MCP tool, add a tool file under `src/tools/desktop/` and register it
in `toolName.ts` + `tools.ts` (and the default profile allowlist in `server.desktop.ts`
if it should ship in the default surface).
