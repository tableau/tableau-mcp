import { resolve } from 'path';
import { z } from 'zod';

import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const uploadWorkbookResultSchema = z.object({
  uploadSessionId: z.string(),
  workbookType: z.enum(['twb', 'twbx']),
});

const publishWorkbookResultSchema = z.object({
  status: z.literal('published'),
  data: workbookSchema,
  url: z.string(),
});

const defaultWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/superstore-datasource.twb');
const twbxWorkbookFilePath = resolve('tests/e2e/fixtures/workbooks/forecast.twbx');
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

  it('uploads then publishes a workbook (.twb) from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    const uploadResult = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: smokeConfig.workbookFilePath },
    });

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        uploadSessionId: uploadResult.uploadSessionId,
        workbookType: uploadResult.workbookType,
        name: smokeConfig.workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    expect(publishResult.data.name).toBe(smokeConfig.workbookName);
    expect(publishResult.url).toEqual(expect.any(String));
  });

  it('uploads then publishes a .twbx workbook from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    const workbookName = `${smokeConfig.workbookName} TWBX`;

    const uploadResult = await client!.callTool('upload-workbook', {
      schema: uploadWorkbookResultSchema,
      toolArgs: { workbookFilePath: twbxWorkbookFilePath },
    });

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        uploadSessionId: uploadResult.uploadSessionId,
        workbookType: uploadResult.workbookType,
        name: workbookName,
        projectId: smokeConfig.projectId,
        overwrite: true,
      },
    });

    expect(publishResult.status).toBe('published');
    expect(publishResult.data.name).toBe(workbookName);
    expect(publishResult.url).toEqual(expect.any(String));
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
