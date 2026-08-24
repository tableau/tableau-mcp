import { resolve } from 'path';
import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const validationFindingSchema = z.object({
  severity: z.string(),
  message: z.string(),
  line: z.number(),
  column: z.number(),
  elementName: z.string(),
});

const validateWorkbookResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid'), warnings: z.array(validationFindingSchema) }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(validationFindingSchema),
    warnings: z.array(validationFindingSchema),
  }),
]);

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');

describe('validate-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getValidateWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('validates a .twb file and reports status valid', async () => {
    const result = await client!.callTool('validate-workbook', {
      schema: validateWorkbookResultSchema,
      toolArgs: { workbookFilePath: defaultWorkbookFilePath },
    });

    expect(result.status).toBe('valid');
  });

  it('is a no-op that reports status valid for a .twbx file without contacting Tableau for validation', async () => {
    const result = await client!.callTool('validate-workbook', {
      schema: validateWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    expect(result).toEqual({ status: 'valid', warnings: [] });
  });
});

function getValidateWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
