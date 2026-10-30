/**
 * Ceiling on the number of tool-input elements the MCP SDK validates in one tools/call.
 *
 * The SDK counts array elements and object keys recursively — the arguments object itself
 * included — and, before a tool's Zod schema runs, refuses any call whose count exceeds this
 * value with `Invalid arguments for tool <name>: arguments contain more than the maximum of N
 * elements`. `maxToolInputElements` is off by default even in @modelcontextprotocol/sdk 1.32.2,
 * so both McpServer construction sites must opt in: src/server.ts (the default, web and desktop
 * entrypoints) and src/index.combined.ts (the shared combined bundle).
 *
 * 2,100 clears every bounded shape this server advertises. The largest is a query-datasource SET
 * filter carrying 2,000 values: 2,009 counted elements for the minimal legal filter (the
 * arguments object and the object/array nesting above `values` included), a few more when its
 * optional `context`, `exclude` and `field` keys are present. 2,000 Pulse metric ids (or metric
 * definition ids) count 2,001. The cap stays below what the 100 KB HTTP body budget permits for
 * the densest legal shape (about 2,600 quoted 36-character LUIDs) while still refusing unbounded
 * argument shapes.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 2_100;
