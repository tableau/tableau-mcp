import { ServerContext } from '@modelcontextprotocol/server';

import { exportedForTesting, getRequestStateCodec, requestStateOptions } from './requestState.js';

const mocks = vi.hoisted(() => ({ requestStateSecret: '' }));

vi.mock('../config.js', () => ({
  getConfig: vi.fn(() => ({ requestStateSecret: mocks.requestStateSecret })),
}));

function makeCtx({
  method = 'tools/call',
  siteId = 'site-1',
  userId = 'user-1',
}: { method?: string; siteId?: string; userId?: string } = {}): ServerContext {
  return {
    mcpReq: { method },
    http: {
      authInfo: {
        token: 'token',
        clientId: 'client',
        scopes: [],
        extra: {
          type: 'Bearer',
          username: 'admin',
          server: 'https://test.tableau.com',
          siteId,
          siteName: 'tc25',
          userId,
          raw: 'raw',
        },
      },
    },
  } as unknown as ServerContext;
}

describe('requestState codec', () => {
  beforeEach(() => {
    mocks.requestStateSecret = '';
    exportedForTesting.resetCodec();
  });

  it('round-trips a payload for the same method and principal', async () => {
    const state = await getRequestStateCodec().mint({ step: 1 }, makeCtx());
    await expect(requestStateOptions.verify(state, makeCtx())).resolves.toEqual({ step: 1 });
  });

  it.each([
    ['another site', { siteId: 'site-2' }],
    ['another user', { userId: 'user-2' }],
    ['another method', { method: 'prompts/get' }],
  ])('rejects state echoed for %s', async (_, other) => {
    const state = await getRequestStateCodec().mint({ step: 1 }, makeCtx());
    await expect(requestStateOptions.verify(state, makeCtx(other))).rejects.toThrow();
  });

  it('rejects tampered state', async () => {
    const state = await getRequestStateCodec().mint({ step: 1 }, makeCtx());
    const tampered = `${state.slice(0, -2)}${state.endsWith('AA') ? 'BB' : 'AA'}`;
    await expect(requestStateOptions.verify(tampered, makeCtx())).rejects.toThrow();
  });

  it('verifies state minted by another process when both share REQUEST_STATE_SECRET', async () => {
    mocks.requestStateSecret = 's'.repeat(32);
    const state = await getRequestStateCodec().mint({ step: 1 }, makeCtx());
    exportedForTesting.resetCodec();
    await expect(requestStateOptions.verify(state, makeCtx())).resolves.toEqual({ step: 1 });
  });

  it('does not verify state from another process without a shared secret', async () => {
    const state = await getRequestStateCodec().mint({ step: 1 }, makeCtx());
    exportedForTesting.resetCodec();
    await expect(requestStateOptions.verify(state, makeCtx())).rejects.toThrow();
  });
});
