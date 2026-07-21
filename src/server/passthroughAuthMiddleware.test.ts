import { WebToolName, webToolNames } from '../tools/web/toolName.js';
import { getRequiredApiScopesForTool } from './oauth/scopes.js';

/**
 * Tools that intentionally have no Tableau REST API scopes and have been explicitly reviewed for
 * passthrough-auth behavior.
 *
 * A reviewed exception must either reject passthrough auth when it needs OAuth-only context, or be
 * demonstrably auth-independent and safe to invoke with passthrough auth. Listing a tool here does
 * not imply that it has a passthrough rejection guard.
 *
 * See: https://github.com/tableau/tableau-mcp/pull/241/changes#r2942474421
 */
const TOOLS_WITHOUT_API_SCOPES_REVIEWED_FOR_PASSTHROUGH: ReadonlyArray<WebToolName> = [
  // Embed token retrieval tool: no Tableau REST API call. The tool callback explicitly returns
  // an error for Passthrough auth (not OAuth), so passthrough callers are rejected.
  'get-embed-token',
  // Token lifecycle tool: no Tableau REST API call. The tool callback explicitly returns an error
  // for Passthrough auth and undefined tableauAuthInfo, so passthrough callers are rejected.
  'revoke-access-token',
  // Consent lifecycle tool: no Tableau REST API call. The tool callback explicitly returns an error
  // for non-Bearer auth types, so passthrough callers are rejected.
  'reset-consent',
  // Pure in-memory pre-flight validator: builds a .twbx from the supplied HTML/assets and checks
  // structure/size/asset-references. It makes NO Tableau REST API call and performs no auth-dependent
  // work, so there is nothing for passthrough auth to reach — it is safe to invoke under any auth type.
  'validate-workbook-package',
  // Data-app workspace authoring tools: they operate entirely on the scoped, server-local
  // DataAppWorkspaceStore (src/dataApps/) via resolveScopeFromExtra, and make NO Tableau REST API
  // call. There is no auth-dependent work for passthrough auth to reach — any authenticated (or
  // single-user stdio) caller may scaffold/author/inspect their own workspace under any auth type.
  'scaffold-data-app',
  'upsert-data-app-files',
  'read-data-app-file',
  'list-data-app-files',
];

describe('passthroughAuthMiddleware', () => {
  it('requires explicit passthrough review for every tool without API scopes', () => {
    const toolsWithoutApiScopes = webToolNames.filter(
      (tool) => getRequiredApiScopesForTool(tool).length === 0,
    );

    const unreviewedTools = toolsWithoutApiScopes.filter(
      (tool) => !TOOLS_WITHOUT_API_SCOPES_REVIEWED_FOR_PASSTHROUGH.includes(tool),
    );

    expect(
      unreviewedTools,
      [
        'This test is designed to fail the first time a tool is added that does not require API scopes.',
        'Review whether the tool must reject passthrough auth or is auth-independent and safe to allow.',
        'Document that behavior, then add the tool name to TOOLS_WITHOUT_API_SCOPES_REVIEWED_FOR_PASSTHROUGH in this file.',
        'See: https://github.com/tableau/tableau-mcp/pull/241/changes#r2942474421',
      ].join('\n'),
    ).toHaveLength(0);
  });
});
