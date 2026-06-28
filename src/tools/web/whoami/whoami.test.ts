import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauWebRequestHandlerExtra } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWhoamiTool } from './whoami.js';

const mocks = vi.hoisted(() => ({
  mockGetCurrentServerSession: vi.fn(),
  mockUseRestApi: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: mocks.mockUseRestApi,
}));

// Default: useRestApi invokes its callback with a restApi exposing the mocked session lookup.
// Tests can override mockUseRestApi to simulate a pre-callback throw (e.g. instance construction
// failing for oauth/passthrough modes).
function defaultUseRestApiImpl({
  callback,
}: {
  callback: (restApi: {
    authenticatedServerMethods: {
      getCurrentServerSession: typeof mocks.mockGetCurrentServerSession;
    };
  }) => Promise<unknown>;
}): Promise<unknown> {
  return callback({
    authenticatedServerMethods: {
      getCurrentServerSession: mocks.mockGetCurrentServerSession,
    },
  });
}

const mockSession = {
  site: { id: 'site-luid-123', name: 'marketing', contentUrl: 'marketing' },
  user: {
    id: 'user-luid-456',
    name: 'jdoe@corp.com',
    fullName: 'Jane Doe',
    email: 'jane@corp.com',
    siteRole: 'SiteAdministratorCreator',
  },
};

describe('whoamiTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockUseRestApi.mockImplementation(defaultUseRestApiImpl);
  });

  it('should create a tool instance with correct properties', () => {
    const whoamiTool = getWhoamiTool(new WebMcpServer());
    expect(whoamiTool.name).toBe('whoami');
    expect(whoamiTool.description).toContain('connected');
    expect(whoamiTool.paramsSchema).toMatchObject({});
  });

  it('should report connection info enriched by the live session', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(new Ok(mockSession));

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data).toMatchObject({
      authMethod: 'pat',
      server: 'https://my-tableau-server.com',
      site: { name: 'marketing', luid: 'site-luid-123', contentUrl: 'marketing' },
      user: {
        username: 'jdoe@corp.com',
        luid: 'user-luid-456',
        fullName: 'Jane Doe',
        email: 'jane@corp.com',
        siteRole: 'SiteAdministratorCreator',
      },
      liveSessionVerified: true,
    });
  });

  it('should degrade gracefully when the live session lookup returns an error', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Err({ type: 'unauthorized', message: 'nope' }),
    );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data.liveSessionVerified).toBe(false);
    // Context-derived facts are still reported.
    expect(data.authMethod).toBe('pat');
    expect(data.server).toBe('https://my-tableau-server.com');
    expect(data.site).toMatchObject({ name: 'tc25', luid: 'test-site-luid' });
    expect(data.user).toMatchObject({ luid: 'test-user-luid' });
    // No PII when the live session was not verified.
    expect(data.user.fullName).toBeUndefined();
    expect(data.user.email).toBeUndefined();
  });

  it('should degrade gracefully when the live session lookup throws', async () => {
    mocks.mockGetCurrentServerSession.mockRejectedValue(new Error('boom'));

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data.liveSessionVerified).toBe(false);
    expect(data.authMethod).toBe('pat');
  });

  it('should degrade gracefully when useRestApi throws before the callback runs', async () => {
    // Simulates the instance-construction throws in getNewRestApiInstanceAsync
    // (e.g. missing server invariant, or "Auth info is required" for oauth/passthrough).
    mocks.mockUseRestApi.mockRejectedValue(
      new Error('Auth info is required when not signing in first.'),
    );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data.liveSessionVerified).toBe(false);
    expect(data.authMethod).toBe('pat');
    expect(data.server).toBe('https://my-tableau-server.com');
    // The live session lookup was never reached.
    expect(mocks.mockGetCurrentServerSession).not.toHaveBeenCalled();
  });

  it('should report credentialType and context-derived user/site for a Bearer session', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(new Err({ type: 'unknown', message: 'x' }));
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = {
      type: 'Bearer',
      username: 'oauth-user@corp.com',
      server: 'https://oauth-server.example.com',
      siteId: 'bearer-site',
      siteName: 'bearer-site-name',
      raw: 'jwt-token',
    };

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data.liveSessionVerified).toBe(false);
    expect(data.credentialType).toBe('Bearer');
    // Username comes from the request's auth info when the live session is unavailable.
    expect(data.user.username).toBe('oauth-user@corp.com');
  });

  it('should keep the context username when the live session omits user.name', async () => {
    mocks.mockGetCurrentServerSession.mockResolvedValue(
      new Ok({
        site: { id: 'site-luid-123', name: 'marketing' },
        user: { id: 'user-luid-456' },
      }),
    );
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = {
      type: 'Passthrough',
      username: 'passthrough-user@corp.com',
      userId: 'user-luid-456',
      server: 'https://my-tableau-server.com',
      siteId: 'site-luid-123',
      siteName: 'marketing',
      raw: 'session-id',
    };

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    const data = parseResult(result);
    expect(data.liveSessionVerified).toBe(true);
    expect(data.credentialType).toBe('Passthrough');
    // Live session had no user.name, so the context username is retained.
    expect(data.user.username).toBe('passthrough-user@corp.com');
    expect(data.user.luid).toBe('user-luid-456');
    // contentUrl is optional on the site schema and may be absent even when verified.
    expect(data.site.contentUrl).toBeUndefined();
  });
});

function parseResult(result: CallToolResult): {
  authMethod: string;
  credentialType?: string;
  server: string;
  site: { name?: string; luid?: string; contentUrl?: string };
  user: { username?: string; luid?: string; fullName?: string; email?: string; siteRole?: string };
  liveSessionVerified: boolean;
} {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult(
  extra: TableauWebRequestHandlerExtra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const whoamiTool = getWhoamiTool(new WebMcpServer());
  const callback = await Provider.from(whoamiTool.callback);
  return await callback({}, extra);
}
