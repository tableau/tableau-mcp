import { Response } from 'express';
import { Ok } from 'ts-results-es';

import * as logger from '../../logging/logger.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import { AccessTokenValidator } from './accessTokenValidator.js';
import { authMiddleware } from './authMiddleware.js';
import {
  getRequiredApiScopesForTool,
  getSupportedApiScopes,
  getSupportedScopes,
  PULSE_LINEAGE_API_SCOPES,
} from './scopes.js';
import { AuthenticatedRequest } from './types.js';

const id = '11111111-1111-4111-8111-111111111111';
vi.mock('../../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: async () => false }),
}));
async function request(
  tool: string,
  args: Record<string, unknown>,
  pulseGrant = false,
): Promise<{
  state: { code: number; headers: Record<string, string>; body: unknown };
  next: ReturnType<typeof vi.fn>;
}> {
  const all = await getSupportedScopes({ includeApiScopes: true });
  const scopes = pulseGrant
    ? all
    : all.filter(
        (scope) =>
          !PULSE_LINEAGE_API_SCOPES.includes(scope as (typeof PULSE_LINEAGE_API_SCOPES)[number]),
      );
  const validator = {
    validate: vi.fn().mockResolvedValue(new Ok({ scopes, clientId: 'lineage-client' })),
  } as unknown as AccessTokenValidator;
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } },
  } as unknown as AuthenticatedRequest;
  const state = { code: 0, headers: {} as Record<string, string>, body: undefined as unknown };
  const res = {
    status(code: number) {
      state.code = code;
      return this;
    },
    header(key: string, value: string) {
      state.headers[key] = value;
      return this;
    },
    json(value: unknown) {
      state.body = value;
      return this;
    },
  } as unknown as Response;
  const next = vi.fn();
  await authMiddleware(validator)(req, res, next);
  return { state, next };
}

describe('optional Pulse lineage OAuth scopes', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.spyOn(logger, 'log').mockImplementation(() => {});
    vi.stubEnv('ADVERTISE_API_SCOPES', 'true');
    vi.stubEnv('OAUTH_DISABLE_SCOPES', 'false');
    vi.stubEnv('INCLUDE_TOOLS', 'get-data-lineage,analyze-data-impact');
    vi.stubEnv('FLOW_READ_TOOLS_ENABLED', 'false');
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each(['get-data-lineage', 'analyze-data-impact'])(
    '%s does not require optional Pulse scopes for ordinary metadata or local sources',
    async (tool) => {
      for (const source of [
        { type: 'field', id: 'opaque' },
        { type: 'local-flow', path: 'C:/Prep/flow.tfl' },
      ]) {
        const result = await request(tool, {
          source,
          includePulseDetails: source.type === 'local-flow',
        });
        expect(result.next).toHaveBeenCalledOnce();
        expect(result.state.code).toBe(0);
      }
    },
  );
  it.each(['get-data-lineage', 'analyze-data-impact'])(
    '%s requires Pulse grants only for explicit inclusion or Pulse origins',
    async (tool) => {
      for (const args of [
        { source: { type: 'field', id: 'opaque' }, includePulseDetails: true },
        { source: { type: 'pulse-definition', luid: id } },
        { source: { type: 'pulse-metric', luid: id } },
      ]) {
        const missing = await request(tool, args);
        expect(missing.next).not.toHaveBeenCalled();
        expect(missing.state.code).toBe(403);
        expect(missing.state.headers['WWW-Authenticate']).toContain('tableau:insight_metrics:read');
        const granted = await request(tool, args, true);
        expect(granted.next).toHaveBeenCalledOnce();
      }
    },
  );
  it('advertises Pulse reads while preserving unchanged base lineage grants', async () => {
    const all = await getSupportedApiScopes();
    const minimum = await getSupportedApiScopes(undefined, { includeOptionalScopes: false });
    for (const scope of PULSE_LINEAGE_API_SCOPES) {
      expect(all).toContain(scope);
      expect(getRequiredApiScopesForTool('get-data-lineage')).not.toContain(scope);
      expect(getRequiredApiScopesForTool('analyze-data-impact')).not.toContain(scope);
    }
    // Existing standalone Pulse tools still contribute their own base grants
    // to global discovery, independently of the optional lineage extension.
    expect(minimum).toEqual(expect.arrayContaining([...PULSE_LINEAGE_API_SCOPES]));
    expect(minimum).not.toContain('tableau:flows:read');
  });
});
