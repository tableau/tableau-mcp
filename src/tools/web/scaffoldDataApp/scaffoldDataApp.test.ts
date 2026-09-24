import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { z } from 'zod';

import { buildTemplateZip } from '../../../scripts/buildTemplateZip.js';
import { WebMcpServer } from '../../../server.web.js';
import { stubDefaultEnvVars } from '../../../testShared.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getScaffoldDataAppTool } from './scaffoldDataApp.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

describe('getScaffoldDataAppTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a tool instance with the expected properties', async () => {
    const tool = getScaffoldDataAppTool(new WebMcpServer());
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
      const tool = getScaffoldDataAppTool(new WebMcpServer());
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
    it('is disabled when the tableau-data-apps flag is off', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(false);
      const tool = getScaffoldDataAppTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(true);
      expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('tableau-data-apps');
    });

    it('is enabled when the tableau-data-apps flag is on', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      const tool = getScaffoldDataAppTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(false);
    });
  });

  describe('callback', () => {
    beforeAll(async () => {
      await buildTemplateZip();
    });

    it('scaffolds a workspace and returns a success result', async () => {
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
    });
  });
});

async function invokeCallback(datappName: string): Promise<CallToolResult> {
  const tool = getScaffoldDataAppTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ datappName }, getMockRequestHandlerExtra());
}
