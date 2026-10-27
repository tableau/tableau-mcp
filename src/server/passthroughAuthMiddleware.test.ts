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
  // MCP app event telemetry: no Tableau REST API call. App-only tool that records telemetry
  // regardless of auth type. Safe with passthrough auth as it only sends telemetry events.
  'record-event',
  // Staged workbook upload URL creation: no Tableau REST API call. The tool callback explicitly
  // returns an error for Passthrough auth before issuing a signed upload URL.
  'request-workbook-upload',
  // Data app scaffolding: no Tableau REST API call in either output mode (writes a bundled
  // template to disk or presigns a GET URL against a pre-published S3 object). The callback never
  // reads tableauAuthInfo, so it behaves identically regardless of auth type — safe with passthrough.
  'scaffold-data-app',
  // Staged data source upload URL creation: no Tableau REST API call. The tool callback explicitly
  // returns an error for Passthrough auth before issuing a signed upload URL.
  'request-datasource-upload',
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
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', undefined);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      ['without an OAuth issuer', undefined],
      ['with a stale OAuth issuer', 'https://stale-issuer.example.com'],
    ])('should return 401 in pure passthrough mode %s', async (_scenario, oauthIssuer) => {
      vi.stubEnv('AUTH', 'passthrough');
      vi.stubEnv('OAUTH_ISSUER', oauthIssuer);
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
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
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
  type RunResult = {
    res: Response;
    next: ReturnType<typeof vi.fn>;
    req: { auth?: { extra?: Record<string, unknown> } };
  };

  describe('session validation with AUTH=passthrough', () => {
    const getSession = vi.fn();

    beforeEach(() => {
      vi.resetModules();
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
      vi.stubEnv('TRANSPORT', 'http');
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', undefined);
      vi.stubEnv('AUTH', 'passthrough');
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);
      vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');
      getSession.mockReset();
      vi.doMock('../sdks/tableau/restApi.js', () => ({
        RestApi: class {
          setCredentials = vi.fn();
          authenticatedServerMethods = { getCurrentServerSession: getSession };
        },
      }));
      vi.doMock('../sdks/tableau/restApi', () => ({
        RestApi: class {
          setCredentials = vi.fn();
          authenticatedServerMethods = { getCurrentServerSession: getSession };
        },
      }));
    });

    afterEach(() => {
      vi.doUnmock('../sdks/tableau/restApi.js');
      vi.doUnmock('../sdks/tableau/restApi');
      vi.unstubAllEnvs();
    });

    const okSession = {
      isOk: () => true,
      value: {
        site: { id: 'site-luid', contentUrl: 'siteB' },
        user: { id: 'user-luid', name: 'u@example.com' },
      },
    };

    async function run(req: Record<string, unknown>): Promise<RunResult> {
      await import('../config.js');
      const { passthroughAuthMiddleware } = await import('./passthroughAuthMiddleware.js');
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();
      await passthroughAuthMiddleware()(req as unknown as Request, res, next);
      return { res, next, req: req as unknown as { auth?: { extra?: Record<string, unknown> } } };
    }

    it.each([
      ['header', { headers: { [X_TABLEAU_AUTH_HEADER]: 'bad' } }],
      ['cookie', { headers: {}, cookies: { workgroup_session_id: 'bad' } }],
    ])('returns 401 with a fixed body for a bad %s token', async (_name, req) => {
      getSession.mockResolvedValue({
        isOk: () => false,
        error: { type: 'unauthorized', message: { code: '401002', detail: 'secret upstream' } },
      });

      const { res, next } = await run(req);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Invalid or expired Tableau session token',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('caps the logged upstream error', async () => {
      const logSpy = vi.spyOn(await import('../logging/logger.js'), 'log');
      getSession.mockResolvedValue({
        isOk: () => false,
        error: { type: 'unknown', message: 'x'.repeat(5000) },
      });

      await run({ headers: { [X_TABLEAU_AUTH_HEADER]: 'valid-token' } });

      const message = logSpy.mock.calls[0][0].message;
      expect(message.length).toBeLessThan(1100);
    });

    it('accepts a cookie-only token', async () => {
      getSession.mockResolvedValue(okSession);

      const { next, req } = await run({
        headers: {},
        cookies: { workgroup_session_id: 'valid-tokenookie' },
      });

      expect(next).toHaveBeenCalled();
      expect(req.auth?.extra).toMatchObject({ raw: 'valid-tokenookie', siteId: 'site-luid' });
    });

    it('prefers the header over the cookie', async () => {
      getSession.mockResolvedValue(okSession);

      const { req } = await run({
        headers: { [X_TABLEAU_AUTH_HEADER]: 'header-token' },
        cookies: { workgroup_session_id: 'valid-tokenookie' },
      });

      expect(req.auth?.extra).toMatchObject({ raw: 'header-token' });
    });

    it('validates a token once and serves repeat requests from the cache', async () => {
      getSession.mockResolvedValue(okSession);
      await import('../config.js');
      const { passthroughAuthMiddleware } = await import('./passthroughAuthMiddleware.js');
      const handler = passthroughAuthMiddleware();
      const call = async (): Promise<void> => {
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
        await handler(
          { headers: { [X_TABLEAU_AUTH_HEADER]: 'same-token' } } as unknown as Request,
          res,
          vi.fn(),
        );
      };

      await call();
      await call();

      expect(getSession).toHaveBeenCalledTimes(1);
    });
  });
  describe('malformed tokens with the real RestApi class', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
      vi.stubEnv('TRANSPORT', 'http');
      vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', undefined);
      vi.stubEnv('AUTH', 'passthrough');
      vi.stubEnv('PAT_NAME', undefined);
      vi.stubEnv('PAT_VALUE', undefined);
      vi.stubEnv('ENABLE_PASSTHROUGH_AUTH', 'true');
      vi.doMock(
        '../sdks/tableau/restApi',
        async () => await vi.importActual('../sdks/tableau/restApi'),
      );
    });

    afterEach(() => {
      vi.doUnmock('../sdks/tableau/restApi');
      vi.unstubAllEnvs();
    });

    it.each([
      ['header', { headers: { [X_TABLEAU_AUTH_HEADER]: 'bad' } }],
      ['cookie', { headers: {}, cookies: { workgroup_session_id: 'abc' } }],
    ])('returns the fixed 401 instead of throwing for a malformed %s token', async (_name, req) => {
      await import('../config.js');
      const { passthroughAuthMiddleware } = await import('./passthroughAuthMiddleware.js');
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
      const next = vi.fn();

      await passthroughAuthMiddleware()(req as unknown as Request, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Invalid or expired Tableau session token',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
