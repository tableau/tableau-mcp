import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../config.js';
import * as loggerModule from '../../../logging/logger.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { MAX_STAGED_UPLOAD_BYTES } from '../stagedUpload.js';
import { getMockRequestHandlerExtra, MOCK_SITE_LUID, MOCK_USER_LUID } from '../toolContext.mock.js';
import { getGetUploadUrlTool } from './getUploadUrl.js';
import { getPickUploadFileTool } from './pickUploadFile.js';

const UPLOAD_ID = '123e4567-e89b-42d3-a456-426614174000';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockIsBlobStorageEnabled: vi.fn(),
  mockGetBlobUploadOrigins: vi.fn(),
  mockRequestStagedUpload: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../blobStorage/init.js', () => ({
  isBlobStorageEnabled: mocks.mockIsBlobStorageEnabled,
  getBlobUploadOrigins: mocks.mockGetBlobUploadOrigins,
}));

vi.mock('../stagedUpload.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stagedUpload.js')>()),
  requestStagedUpload: mocks.mockRequestStagedUpload,
}));

const oauthExtra = (): ReturnType<typeof getMockRequestHandlerExtra> =>
  getMockRequestHandlerExtra({ config: { ...getConfig(), auth: 'oauth' } });

function parse(result: CallToolResult): Record<string, unknown> {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

describe('upload picker tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockIsBlobStorageEnabled.mockReturnValue(true);
    mocks.mockRequestStagedUpload.mockResolvedValue({
      uploadId: UPLOAD_ID,
      uploadUrl: 'https://blob.example.com/signed-put',
      expiresAt: '2026-08-12T18:05:00.000Z',
      maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
      requiredHeaders: { 'Content-Type': 'application/octet-stream' },
    });
  });

  describe('pick-upload-file', () => {
    it('renders the upload-picker app, gated on mcp-apps, with blob upload origins in its CSP', async () => {
      const tool = getPickUploadFileTool(new WebMcpServer());

      expect(tool.app).toMatchObject({
        resourceUri: 'ui://pick-upload-file/upload-picker.html',
        htmlPath: 'web/apps/dist/upload-picker.html',
        hideWhenUnsupported: true,
      });
      expect(tool.app?.extraConnectDomains).toBe(mocks.mockGetBlobUploadOrigins);
      expect(await Provider.from(tool.disabled)).toBe(false);

      mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => flag !== 'mcp-apps');
      expect(await Provider.from(tool.disabled)).toBe(true);
    });

    it('returns an uploadId and accepted types to the model, but no upload URL', async () => {
      const tool = getPickUploadFileTool(new WebMcpServer());
      const result = await (await Provider.from(tool.callback))({}, oauthExtra());

      expect(result.isError).toBe(false);
      const body = parse(result);
      expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
      expect(body.acceptedFileTypes).toEqual(expect.arrayContaining(['twb', 'twbx']));
      expect(body).not.toHaveProperty('uploadUrl');
      expect(mocks.mockRequestStagedUpload).not.toHaveBeenCalled();
    });

    it.each([getPickUploadFileTool, getGetUploadUrlTool])(
      'rejects Passthrough auth for %#',
      async (factory) => {
        const tool = factory(new WebMcpServer());
        const result = await (
          await Provider.from(tool.callback)
        )(
          { uploadId: UPLOAD_ID, fileName: 'Sales.twbx', fileSize: 1 } as any,
          getMockRequestHandlerExtra({
            tableauAuthInfo: {
              type: 'Passthrough',
              username: 'viewer@example.com',
              userId: 'test-user-id',
              server: 'https://tableau.example.com',
              siteId: 'test-site-id',
              siteName: 'test-site',
              raw: 'passthrough-token',
            },
          }),
        );

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain('Passthrough authentication');
        expect(mocks.mockRequestStagedUpload).not.toHaveBeenCalled();
      },
    );
  });

  describe('get-upload-url', () => {
    it('is app-only and signs a URL for the picked file under the given uploadId', async () => {
      const tool = getGetUploadUrlTool(new WebMcpServer());
      expect(tool.meta).toEqual({ ui: { visibility: ['app'] } });

      const result = await (
        await Provider.from(tool.callback)
      )({ uploadId: UPLOAD_ID, fileName: 'Sales.twbx', fileSize: 1024 }, oauthExtra());

      expect(result.isError).toBe(false);
      expect(parse(result)).toEqual({
        uploadUrl: 'https://blob.example.com/signed-put',
        requiredHeaders: { 'Content-Type': 'application/octet-stream' },
        expiresAt: '2026-08-12T18:05:00.000Z',
        maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
      });
      expect(mocks.mockRequestStagedUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: 'Sales.twbx',
          uploadId: UPLOAD_ID,
          tenant: { siteLuid: MOCK_SITE_LUID, userLuid: MOCK_USER_LUID },
        }),
      );
    });

    it('rejects a file over the size cap before signing', async () => {
      const tool = getGetUploadUrlTool(new WebMcpServer());
      const result = await (
        await Provider.from(tool.callback)
      )(
        { uploadId: UPLOAD_ID, fileName: 'Sales.twbx', fileSize: MAX_STAGED_UPLOAD_BYTES + 1 },
        oauthExtra(),
      );

      expect(result.isError).toBe(true);
      expect(mocks.mockRequestStagedUpload).not.toHaveBeenCalled();
    });
  });
});
