import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { z } from 'zod';

import { buildTemplateZip } from '../../../scripts/buildTemplateZip.js';
import { ProductVersion } from '../../../sdks/tableau/types/serverInfo.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getScaffoldDataAppTool } from './scaffoldDataApp.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockGetAllowedOrigins: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      packagesMethods: {
        getAllowedOrigins: mocks.mockGetAllowedOrigins,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

// Floor is 2026.3.1 (see scaffoldDataApp.ts).
const VERSION_AT_FLOOR: ProductVersion = { value: '2026.3.1', build: '' };
const VERSION_BELOW: ProductVersion = { value: '2026.2.0', build: '' };
const VERSION_ABOVE: ProductVersion = { value: '2027.1.0', build: '' };
const VERSION_MAIN: ProductVersion = { value: 'main', build: 'main.26.0804.1416' };
const VERSION_UNKNOWN: ProductVersion = { value: 'garbage', build: '' };

function makeTool(
  productVersion: ProductVersion = VERSION_AT_FLOOR,
): ReturnType<typeof getScaffoldDataAppTool> {
  return getScaffoldDataAppTool(new WebMcpServer(), productVersion);
}

describe('getScaffoldDataAppTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockGetAllowedOrigins.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with the expected properties', async () => {
    const tool = makeTool();
    expect(tool.name).toBe('scaffold-data-app');
    expect(tool.description).toContain('data app');
    expect(tool.paramsSchema).toMatchObject({
      datappName: expect.any(Object),
    });

    const annotations = await Provider.from(tool.annotations);
    expect(annotations.title).toBe('Scaffold Data App');
    expect(annotations.readOnlyHint).toBe(false);
    expect(annotations.openWorldHint).toBe(false);
  });

  describe('datappName schema', () => {
    async function datappNameSchema(): Promise<z.ZodType<string>> {
      const tool = makeTool();
      return (await Provider.from(tool.paramsSchema)).datappName;
    }

    it('accepts ordinary names including internal spaces', async () => {
      const schema = await datappNameSchema();
      expect(schema.safeParse('Sales Demo').success).toBe(true);
      expect(schema.safeParse('report_2024-Q1').success).toBe(true);
    });

    it('rejects path separators, traversal, empty, and overlong names', async () => {
      const schema = await datappNameSchema();
      expect(schema.safeParse('a/b').success).toBe(false);
      expect(schema.safeParse('../evil').success).toBe(false);
      expect(schema.safeParse('..').success).toBe(false);
      expect(schema.safeParse('').success).toBe(false);
      expect(schema.safeParse(' leading').success).toBe(false);
      expect(schema.safeParse('a'.repeat(101)).success).toBe(false);
    });
  });

  describe('feature gate (disabled provider)', () => {
    it('is disabled when the data-apps flag is off', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);
      const tool = makeTool();
      expect(await Provider.from(tool.disabled)).toBe(true);
      expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('data-apps');
    });

    it('is enabled when the data-apps flag is on and the version is at the floor', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      const tool = makeTool(VERSION_AT_FLOOR);
      expect(await Provider.from(tool.disabled)).toBe(false);
    });
  });

  describe('version gate (disabled provider)', () => {
    beforeEach(() => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    });

    it('is enabled at or above the version floor', async () => {
      expect(await Provider.from(makeTool(VERSION_AT_FLOOR).disabled)).toBe(false);
      expect(await Provider.from(makeTool(VERSION_ABOVE).disabled)).toBe(false);
    });

    it('is disabled below the version floor', async () => {
      expect(await Provider.from(makeTool(VERSION_BELOW).disabled)).toBe(true);
    });

    it('is disabled for a dev build reporting "main" (no escape hatch)', async () => {
      expect(await Provider.from(makeTool(VERSION_MAIN).disabled)).toBe(true);
    });

    it('is disabled for an unparseable version', async () => {
      expect(await Provider.from(makeTool(VERSION_UNKNOWN).disabled)).toBe(true);
    });

    it('is disabled below the floor even when the flag is on and above when off', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);
      expect(await Provider.from(makeTool(VERSION_ABOVE).disabled)).toBe(true);
    });
  });

  describe('callback', () => {
    beforeAll(async () => {
      await buildTemplateZip();
    });

    it('scaffolds a workspace and returns a success result with allowed origins', async () => {
      mocks.mockGetAllowedOrigins.mockResolvedValue(['https://example.com']);
      const result = await invokeCallback('Sales Demo');
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      // Local mode returns the un-substituted template zip already on disk, plus a postUnzip plan.
      expect(existsSync(payload.filePath)).toBe(true);
      expect(payload.postUnzip.renames).toContainEqual({
        from: 'Data App Name',
        to: 'Sales Demo',
      });
      expect(payload.allowedOrigins).toEqual(['https://example.com']);
    });

    it('omits allowedOrigins and still succeeds when the allowed-origins read fails', async () => {
      mocks.mockGetAllowedOrigins.mockRejectedValue(new Error('Packages feature not enabled'));
      const result = await invokeCallback('Sales Demo');
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(existsSync(payload.filePath)).toBe(true);
      expect(payload.allowedOrigins).toBeUndefined();
    });
  });
});

async function invokeCallback(datappName: string): Promise<CallToolResult> {
  const tool = makeTool();
  const callback = await Provider.from(tool.callback);
  return await callback({ datappName }, getMockRequestHandlerExtra());
}
