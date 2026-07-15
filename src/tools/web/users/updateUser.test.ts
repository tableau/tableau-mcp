import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { mockUser } from './mockUser.js';
import { getUpdateUserTool } from './updateUser.js';

const mocks = vi.hoisted(() => ({
  mockQueryUserOnSite: vi.fn(),
  mockUpdateUser: vi.fn(),
  mockGuardMutation: vi.fn(),
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

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

vi.mock('../_lib/mutationGuard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/mutationGuard.js')>();
  return {
    ...actual,
    guardMutation: mocks.mockGuardMutation,
  };
});

vi.mock('../_lib/evidence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/evidence.js')>();
  return {
    ...actual,
    RegistryEvidence: vi.fn().mockImplementation(() => ({
      establish: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
      describeEvidence: () => ({ kind: 'registry-nonce' }),
      getEstablishedNonce: () => 'mock-nonce-123',
    })),
  };
});

function mockGuardSuccess(): void {
  mocks.mockGuardMutation.mockResolvedValue(
    new Ok({
      actor: { siteLuid: 'test-site-id', siteName: 'tc25' },
      target: { id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', name: 'jsmith', kind: 'user' },
      recordOutcome: vi.fn(),
    }),
  );
}

describe('updateUserTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGuardSuccess();
  });

  it('should create a tool instance with correct properties', () => {
    const updateUserTool = getUpdateUserTool(new WebMcpServer());
    expect(updateUserTool.name).toBe('update-user');
    expect(updateUserTool.description).toContain('Updates the site role of a user');
  });

  describe('preview phase', () => {
    it('should return preview text with current and proposed role', async () => {
      mocks.mockQueryUserOnSite.mockResolvedValue({
        ...mockUser,
        siteRole: 'Creator',
        email: 'john.smith@example.com',
      });

      const result = await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: 'text' });
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain('Preview');
      expect(text).toContain('Creator');
      expect(text).toContain('Unlicensed');
      expect(text).toContain('jsmith');
      expect(text).toContain('mock-nonce-123');
    });

    it('should call guardMutation with preview phase and correct binding', async () => {
      mocks.mockQueryUserOnSite.mockResolvedValue(mockUser);

      await getToolResult({ userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', siteRole: 'Viewer' });

      expect(mocks.mockGuardMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'update-user',
          action: 'update',
          mode: 'preview-confirm',
          phase: 'preview',
          binding: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890:Viewer',
        }),
      );
    });
  });

  describe('confirm phase', () => {
    it('should update user and return success message', async () => {
      mocks.mockUpdateUser.mockResolvedValue({ ...mockUser, siteRole: 'Unlicensed' });

      const result = await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
        confirm: true,
        confirmationToken: 'test-token',
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { type: string; text: string }).text;
      expect(text).toContain('successfully updated');
      expect(text).toContain('Unlicensed');
      expect(mocks.mockUpdateUser).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
      });
    });

    it('should call guardMutation with confirm phase', async () => {
      mocks.mockUpdateUser.mockResolvedValue({ ...mockUser, siteRole: 'Viewer' });

      await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Viewer',
        confirm: true,
        confirmationToken: 'test-token',
      });

      expect(mocks.mockGuardMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'update-user',
          action: 'update',
          mode: 'preview-confirm',
          phase: 'confirm',
          binding: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890:Viewer',
          confirmationToken: 'test-token',
        }),
      );
    });

    it('should record outcome on REST failure', async () => {
      const recordOutcome = vi.fn();
      mocks.mockGuardMutation.mockResolvedValue(
        new Ok({
          actor: { siteLuid: 'test-site-id', siteName: 'tc25' },
          target: { id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', name: 'jsmith', kind: 'user' },
          recordOutcome,
        }),
      );
      mocks.mockUpdateUser.mockRejectedValue(new Error('Network timeout'));

      const result = await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
        confirm: true,
        confirmationToken: 'test-token',
      });

      expect(recordOutcome).toHaveBeenCalledWith({
        ok: false,
        failureDetail: 'Network timeout',
      });
      expect(result.isError).toBe(true);
    });

    it('should record success outcome on successful update', async () => {
      const recordOutcome = vi.fn();
      mocks.mockGuardMutation.mockResolvedValue(
        new Ok({
          actor: { siteLuid: 'test-site-id', siteName: 'tc25' },
          target: { id: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890', name: 'jsmith', kind: 'user' },
          recordOutcome,
        }),
      );
      mocks.mockUpdateUser.mockResolvedValue({ ...mockUser, siteRole: 'Unlicensed' });

      await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
        confirm: true,
        confirmationToken: 'test-token',
      });

      expect(recordOutcome).toHaveBeenCalledWith({ ok: true });
    });
  });

  describe('guard rejection', () => {
    it('should return error when guard rejects (not admin)', async () => {
      const { AdminOnlyError } = await import('../../../errors/mcpToolError.js');
      mocks.mockGuardMutation.mockResolvedValue(new AdminOnlyError('Not admin').toErr());

      const result = await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
      });

      expect(result.isError).toBe(true);
    });

    it('should return error when guard rejects (preview not run)', async () => {
      const { PreviewNotRunError } = await import('../../../errors/mcpToolError.js');
      mocks.mockGuardMutation.mockResolvedValue(new PreviewNotRunError('Preview not run').toErr());

      const result = await getToolResult({
        userId: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
        siteRole: 'Unlicensed',
        confirm: true,
        confirmationToken: 'bad-token',
      });

      expect(result.isError).toBe(true);
    });
  });
});

async function getToolResult(args: any): Promise<CallToolResult> {
  const updateUserTool = getUpdateUserTool(new WebMcpServer());
  const callback = await Provider.from(updateUserTool.callback);
  return await callback(args, getMockRequestHandlerExtra());
}
