/**
 * update-user end-to-end through the REAL mutation guard and SignedTokenEvidence (the sibling
 * updateUser.test.ts mocks the guard). Covers: preview returns a v1 token, confirm succeeds, a role
 * change between preview and confirm is rejected, and a confirm on a fresh process sharing
 * MUTATION_TOKEN_SECRET (cross-replica) succeeds.
 */
import { CallToolResult } from '@modelcontextprotocol/server';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { exportedForTesting as signedTokenTesting } from '../_lib/signedTokenEvidence.js';
import { mutationTokenConfigFromEnv } from '../_lib/signedTokenEvidence.mock.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockUser } from './mockUser.js';
import { getUpdateUserTool } from './updateUser.js';

vi.mock('../../../logging/logger.js');

const mocks = vi.hoisted(() => ({
  mockQueryUserOnSite: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      usersMethods: {
        queryUserOnSite: mocks.mockQueryUserOnSite,
        updateUser: mocks.mockUpdateUser,
      },
      siteId: 'test-site-id',
      userId: 'test-user-id',
    }),
  ),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../adminGate.js', () => ({ assertAdmin: mocks.mockAssertAdmin }));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    ...mutationTokenConfigFromEnv(),
    adminToolsEnabled: true,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const USER_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const TOKEN_PATTERN =
  /confirmationToken:[^v]*(v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43})/;

async function call(args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = getUpdateUserTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(args as never, getMockRequestHandlerExtra());
}

function text(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

async function preview(siteRole = 'Unlicensed'): Promise<string> {
  const result = await call({ userId: USER_ID, siteRole });
  expect(result.isError).toBeFalsy();
  const match = text(result).match(TOKEN_PATTERN);
  invariant(match, `expected a v1 token in: ${text(result)}`);
  return match[1];
}

describe('update-user with SignedTokenEvidence (real guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedTokenTesting.reset();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockQueryUserOnSite.mockResolvedValue({ ...mockUser, siteRole: 'Creator' });
    mocks.mockUpdateUser.mockResolvedValue({ ...mockUser, siteRole: 'Unlicensed' });
  });

  afterEach(() => {
    signedTokenTesting.reset();
  });

  it('preview returns a v1 token and applies nothing', async () => {
    const token = await preview();
    expect(token.startsWith('v1.')).toBe(true);
    expect(mocks.mockUpdateUser).not.toHaveBeenCalled();
  });

  it('confirm with the preview token applies the role change', async () => {
    const token = await preview();
    const result = await call({
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('successfully updated');
    expect(mocks.mockUpdateUser).toHaveBeenCalledOnce();
  });

  it('rejects the confirm when the user role changed after the preview', async () => {
    const token = await preview();
    // Someone else changed the user's role between preview and confirm.
    mocks.mockQueryUserOnSite.mockResolvedValue({ ...mockUser, siteRole: 'Explorer' });
    const result = await call({
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('The target changed after the preview');
    expect(mocks.mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects a token previewed for a different target role', async () => {
    const token = await preview('Viewer');
    const result = await call({
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    });
    expect(result.isError).toBe(true);
    expect(text(result)).not.toContain('The target changed after the preview');
    expect(mocks.mockUpdateUser).not.toHaveBeenCalled();
  });

  it('confirms on a fresh process with the same MUTATION_TOKEN_SECRET (cross-replica)', async () => {
    vi.stubEnv('MUTATION_TOKEN_SECRET', 'update-user-replica-secret-0123456789abcd');
    signedTokenTesting.reset();
    const token = await preview();
    signedTokenTesting.reset(); // another replica: fresh keys + replay cache, same secret
    const result = await call({
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    });
    expect(result.isError).toBeFalsy();
    expect(mocks.mockUpdateUser).toHaveBeenCalledOnce();
  });

  it('rejects a cross-replica replay once the role was applied (state moved)', async () => {
    vi.stubEnv('MUTATION_TOKEN_SECRET', 'update-user-replica-secret-0123456789abcd');
    signedTokenTesting.reset();
    const token = await preview();
    const args = {
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    };
    expect((await call(args)).isError).toBeFalsy();
    // The first confirm applied the change, so the live role is now Unlicensed.
    mocks.mockQueryUserOnSite.mockResolvedValue({ ...mockUser, siteRole: 'Unlicensed' });
    signedTokenTesting.reset(); // replay lands on another replica
    expect((await call(args)).isError).toBe(true);
    expect(mocks.mockUpdateUser).toHaveBeenCalledOnce();
  });

  it('rejects a replay on the same replica', async () => {
    const token = await preview();
    const args = {
      userId: USER_ID,
      siteRole: 'Unlicensed',
      confirm: true,
      confirmationToken: token,
    };
    expect((await call(args)).isError).toBeFalsy();
    expect((await call(args)).isError).toBe(true);
    expect(mocks.mockUpdateUser).toHaveBeenCalledOnce();
  });
});
