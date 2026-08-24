import { resolve } from 'path';
import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const uploadWorkbookResultSchema = z.object({
  uploadSessionId: z.string(),
  workbookType: z.enum(['twb', 'twbx']),
});

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');

describe('upload-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getUploadWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('uploads a .twb file and returns workbookType twb', async () => {
    const result = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: defaultWorkbookFilePath },
    });

    expect(result.workbookType).toBe('twb');
    expect(result.uploadSessionId).toEqual(expect.any(String));
  });

  it('uploads a .twbx file and returns workbookType twbx', async () => {
    const result = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    expect(result.workbookType).toBe('twbx');
    expect(result.uploadSessionId).toEqual(expect.any(String));
  });
});

function getUploadWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
