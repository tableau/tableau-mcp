import { WebToolName, webToolNames } from '../tools/web/toolName.js';
import { getRequiredApiScopesForTool } from './oauth/scopes.js';

/**
 * Tools that intentionally have no Tableau REST API scopes, but have been reviewed and verified
 * to handle passthrough auth in their own tool callback (returning an appropriate error).
 *
 * When adding a new tool here, confirm the tool explicitly checks `tableauAuthInfo.type` and
 * returns an error for unsupported auth types (e.g. Passthrough), so it cannot be accidentally
 * called without proper OAuth context.
 *
 * See: https://github.com/tableau/tableau-mcp/pull/241/changes#r2942474421
 */
const TOOLS_WITHOUT_API_SCOPES_WITH_PASSTHROUGH_GUARD: ReadonlyArray<WebToolName> = [
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
];

describe('passthroughAuthMiddleware', () => {
  it('disallow passthrough auth when calling a tool without API scopes ', () => {
    const toolsWithoutApiScopes = webToolNames.filter(
      (tool) => getRequiredApiScopesForTool(tool).length === 0,
    );

    const unguardedTools = toolsWithoutApiScopes.filter(
      (tool) => !TOOLS_WITHOUT_API_SCOPES_WITH_PASSTHROUGH_GUARD.includes(tool),
    );

    expect(
      unguardedTools,
      [
        'This test is designed to fail the first time a tool is added that does not require API scopes.',
        'If you see this error, and your tool indeed requires no API scopes, you must add the appropriate logic to prevent calling the tool with passthrough auth.',
        'Then add the tool name to TOOLS_WITHOUT_API_SCOPES_WITH_PASSTHROUGH_GUARD in this file.',
        'See: https://github.com/tableau/tableau-mcp/pull/241/changes#r2942474421',
      ].join('\n'),
    ).toHaveLength(0);
  });
});
