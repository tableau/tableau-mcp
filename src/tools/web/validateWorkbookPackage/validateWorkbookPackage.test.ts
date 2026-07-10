import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateWorkbookPackageTool } from './validateWorkbookPackage.js';

// No REST mock here on purpose: validate-workbook-package makes no network call. If it ever tried,
// useRestApi would be the un-mocked real module and the test would fail loudly.
vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const base = {
  packageId: 'com.example.myviz',
  workbookName: 'My Viz',
  html: '<!doctype html><html><body><script>render([1,2,3]);</script></body></html>',
};

describe('validateWorkbookPackageTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a tool instance with the correct properties and no publish params', async () => {
    const tool = getValidateWorkbookPackageTool(new WebMcpServer());
    expect(tool.name).toBe('validate-workbook-package');
    expect(tool.description).toContain('without publishing');
    // Reuses the build params...
    expect(tool.paramsSchema).toHaveProperty('packageId');
    expect(tool.paramsSchema).toHaveProperty('html');
    // ...but adds NO publish-target params.
    expect(tool.paramsSchema).not.toHaveProperty('projectId');
    expect(tool.paramsSchema).not.toHaveProperty('showTabs');
    expect(tool.paramsSchema).not.toHaveProperty('overwrite');
    // Plain-JSON tool: neither app nor meta.
    expect(tool.app).toBeUndefined();
    expect(tool.meta).toBeUndefined();
    // read-only pre-flight annotations. (annotations is a TypeOrProvider — resolve it first.)
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.destructiveHint).toBe(false);
    expect(annotations?.idempotentHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
    // The description must end with the exact required disclaimer sentence.
    expect(tool.description).toMatch(
      /A successful \(ok:true\) result means the package is structurally VALID and under 64 MB\. It does NOT mean the dashboard is good, nor that every asset will render — review the inline preview before publishing\.$/,
    );
  });

  it('returns ok:true with empty warnings and byteLength>0 for a good package', async () => {
    const result = await getToolResult(base);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.warnings).toEqual([]);
    expect(payload.byteLength).toBeGreaterThan(0);
    // Plain-JSON result: no MCP-Apps discriminator.
    expect(payload).not.toHaveProperty('appView');
  });

  it('returns ok:false with the missing-asset warning when the html references an unbundled asset', async () => {
    const result = await getToolResult({
      ...base,
      html: '<!doctype html><script src="chart-lib.js"></script>',
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(false);
    expect(payload.warnings.some((w: string) => w.includes('chart-lib.js'))).toBe(true);
  });

  it('does not warn when the referenced asset is bundled', async () => {
    const result = await getToolResult({
      ...base,
      html: '<!doctype html><script src="chart-lib.js"></script>',
      assets: [{ path: 'chart-lib.js', base64: Buffer.from('console.log(1)').toString('base64') }],
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.warnings).toEqual([]);
  });

  it('surfaces a malformed packageId as an error result (not a thrown exception)', async () => {
    const result = await getToolResult({ ...base, packageId: '1bad id!' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    // Clean McpToolError text, not the generic "requestId: ..., error:" catch line.
    expect(result.content[0].text).toContain('is not a legal extension id');
    expect(result.content[0].text).not.toContain('requestId:');
  });
});

async function getToolResult(args: {
  packageId: string;
  workbookName: string;
  html: string;
  assets?: Array<{ path: string; base64: string }>;
  toolbarLabel?: string;
}): Promise<CallToolResult> {
  const tool = getValidateWorkbookPackageTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      packageId: args.packageId,
      workbookName: args.workbookName,
      html: args.html,
      assets: args.assets,
      toolbarLabel: args.toolbarLabel,
    },
    getMockRequestHandlerExtra(),
  );
}
