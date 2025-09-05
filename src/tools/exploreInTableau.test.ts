import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { server } from '../server.js';
import { exploreInTableauTool } from './exploreInTableau.js';

// Mock server.server.sendLoggingMessage since the transport won't be connected.
vi.spyOn(server.server, 'sendLoggingMessage').mockImplementation(vi.fn());

const mockRedirectUrl = 'https://example.com/tableau/redirect';

const mocks = vi.hoisted(() => ({
  mockExploreInTableau: vi.fn(),
}));

vi.mock('../sdks/tableau/methods/exploreInTableauMethods.js', () => ({
  default: vi.fn().mockImplementation(() => ({
    exploreInTableau: mocks.mockExploreInTableau,
  })),
}));

describe('exploreInTableauTool', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      IA_API_KEY: 'test-api-key',
      SERVER: 'https://test-tableau-server.com',
      SALESFORCE_REGION: 'us-west-2',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  async function getToolResult(params: { tdsContent: string }): Promise<CallToolResult> {
    return await exploreInTableauTool.callback(params, {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    });
  }

  it('should create a tool instance with correct properties', () => {
    expect(exploreInTableauTool.name).toBe('explore-in-tableau');
    expect(exploreInTableauTool.description).toContain('Submit TDS (Tableau Data Source) content');
    expect(exploreInTableauTool.paramsSchema).toMatchObject({ tdsContent: expect.any(Object) });
  });

  it('should successfully submit TDS content and return redirect URL', async () => {
    mocks.mockExploreInTableau.mockResolvedValue(mockRedirectUrl);

    const rawTdsContent = `<?xml version="1.0" encoding="UTF-8"?>
<datasource formatted-name="Sample Data" inline="true" version="18.1">
  <!-- Sample TDS content -->
</datasource>`;

    const result = await getToolResult({ tdsContent: rawTdsContent });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('https://example.com/tableau/redirect');
    expect(mocks.mockExploreInTableau).toHaveBeenCalledWith(rawTdsContent);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'External API Error';
    mocks.mockExploreInTableau.mockRejectedValue(new Error(errorMessage));

    const rawTdsContent = `<?xml version="1.0" encoding="UTF-8"?>
<datasource formatted-name="Sample Data" inline="true" version="18.1">
  <!-- Sample TDS content -->
</datasource>`;

    const result = await getToolResult({ tdsContent: rawTdsContent });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should validate required parameters', async () => {
    const result = await getToolResult({ tdsContent: '' });

    expect(result.isError).toBe(true);
  });
}); 