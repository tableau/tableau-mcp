import { resolve } from 'path';
import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
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

const publishWorkbookResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('published'),
    data: workbookSchema,
    url: z.string(),
    warnings: z.array(validationFindingSchema),
  }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(validationFindingSchema),
    warnings: z.array(validationFindingSchema),
  }),
]);

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');
const malformedWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/malformed-datasource.twb');
const malformedTwbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/badtwbx.twbx');
const defaultProjectId = 'd87d843b-4326-4ce3-bc50-a68c1e6c9ca5';

type PublishWorkbookSmokeConfig = {
  workbookFilePath: string;
  workbookName: string;
  projectId: string;
};

describe('publish-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    setEnv();
  });

  afterAll(() => {
    resetEnv();
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getPublishWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('validates and publishes a workbook (.twb) from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: smokeConfig.workbookFilePath,
        name: smokeConfig.workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    if (publishResult.status === 'published') {
      expect(publishResult.data.name).toBe(smokeConfig.workbookName);
      expect(publishResult.url).toEqual(expect.any(String));
    }
  });

  it('validates and publishes a .twbx workbook from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    const workbookName = `${smokeConfig.workbookName} TWBX`;

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: twbxWorkbookFilePath,
        name: workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    if (publishResult.status === 'published') {
      expect(publishResult.data.name).toBe(workbookName);
      expect(publishResult.url).toEqual(expect.any(String));
    }
  });

  it('returns validation errors and does not publish a malformed .twb workbook', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: malformedWorkbookFilePath,
        name: `${smokeConfig.workbookName} Malformed TWB`,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('invalid');
    if (publishResult.status === 'invalid') {
      expect(publishResult.errors.length).toBeGreaterThan(0);
      expect(publishResult.errors[0]).toMatchObject({
        severity: 'ERROR',
        message: expect.any(String),
        line: expect.any(Number),
        column: expect.any(Number),
        elementName: expect.any(String),
      });
    }
  });

  it('returns a publish error and does not publish a .twbx containing a malformed .twb', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    await expect(
      client!.callTool('publish-workbook', {
        schema: publishWorkbookResultSchema,
        toolArgs: {
          workbookFilePath: malformedTwbxWorkbookFilePath,
          name: `${smokeConfig.workbookName} Bad TWBX`,
          projectId: smokeConfig.projectId,
          overwrite: true,
        },
      }),
    ).rejects.toThrow(/status code 400|bad workbook|publish/i);
  });
});

function getPublishWorkbookSmokeConfig(): PublishWorkbookSmokeConfig {
  return {
    workbookFilePath: process.env.PUBLISH_WORKBOOK_E2E_FILE?.trim() || defaultWorkbookFilePath,
    workbookName: process.env.PUBLISH_WORKBOOK_E2E_NAME?.trim() || 'Codex Publish Workbook E2E',
    projectId: process.env.PUBLISH_WORKBOOK_E2E_PROJECT_ID?.trim() || defaultProjectId,
  };
}

function getPublishWorkbookSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
