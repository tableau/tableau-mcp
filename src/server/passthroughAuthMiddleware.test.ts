import { Request, Response } from 'express';

import { stubDefaultEnvVars } from '../testShared.js';
import { WebToolName, webToolNames } from '../tools/web/toolName.js';
import { getRequiredApiScopesForTool } from './oauth/scopes.js';
import { X_TABLEAU_AUTH_HEADER } from './passthroughAuthMiddleware.js';

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

  describe('middleware behavior with AUTH=passthrough', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
      vi.stubEnv('TRANSPORT', 'http');
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('should return 401 when config.auth is passthrough and no token present', async () => {
      vi.stubEnv('AUTH', 'passthrough');
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);
      vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

      await import('../config.js');

      const { passthroughAuthMiddleware: middleware } =
        await import('./passthroughAuthMiddleware.js');
      const handler = middleware();

      const req = { headers: {} } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      await handler(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description:
          'Missing token: provide an X-Tableau-Auth header or workgroup_session_id cookie',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when config.auth is pat and no token present', async () => {
      vi.stubEnv('AUTH', 'pat');
      vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

      await import('../config.js');

      const { passthroughAuthMiddleware: middleware } =
        await import('./passthroughAuthMiddleware.js');
      const handler = middleware();

      const req = { headers: {} } as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should proceed when token is present regardless of auth type', async () => {
      vi.stubEnv('AUTH', 'passthrough');
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);
      vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');

      await import('../config.js');

      const { passthroughAuthMiddleware: middleware } =
        await import('./passthroughAuthMiddleware.js');
      const handler = middleware();

      const req = { headers: { [X_TABLEAU_AUTH_HEADER]: 'mock-token' } } as unknown as Request;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
