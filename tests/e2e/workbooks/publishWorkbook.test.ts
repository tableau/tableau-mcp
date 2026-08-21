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

type PublishWorkbookSmokeConfig = {
  workbookFilePath: string;
  workbookName: string;
  projectId: string;
};

describe('publish-workbook local file', () => {
  let client: McpClient | undefined;

  beforeAll(() => {
    if (isPublishWorkbookSmokeRequested()) {
      setEnv();
    }
  });

  afterAll(() => {
    if (isPublishWorkbookSmokeRequested()) {
      resetEnv();
    }
  });

  beforeAll(async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    if (!smokeConfig) {
      return;
    }

    await buildVariant('default');
    client = new McpClient({ env: getPublishWorkbookSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
  });

  it('validates and publishes a workbook (.twb) from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    if (!smokeConfig || !client) {
      console.warn('Skipping publish-workbook e2e. Set PUBLISH_WORKBOOK_E2E=true to run it.');
      return;
    }

    const publishResult = await client.callTool('publish-workbook', {
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
    if (!smokeConfig || !client) {
      console.warn('Skipping publish-workbook e2e. Set PUBLISH_WORKBOOK_E2E=true to run it.');
      return;
    }

    const workbookName = `${smokeConfig.workbookName} TWBX`;

    const publishResult = await client.callTool('publish-workbook', {
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
});

function getPublishWorkbookSmokeConfig(): PublishWorkbookSmokeConfig | undefined {
  if (!isPublishWorkbookSmokeRequested()) {
    return undefined;
  }
  const projectId = process.env.PUBLISH_WORKBOOK_E2E_PROJECT_ID?.trim();
  if (!projectId) {
    console.warn(
      'Skipping publish-workbook e2e. Set PUBLISH_WORKBOOK_E2E_PROJECT_ID to the destination project LUID.',
    );
    return undefined;
  }

  return {
    workbookFilePath: process.env.PUBLISH_WORKBOOK_E2E_FILE?.trim() || defaultWorkbookFilePath,
    workbookName: process.env.PUBLISH_WORKBOOK_E2E_NAME?.trim() || 'Codex Publish Workbook E2E',
    projectId,
  };
}

function isPublishWorkbookSmokeRequested(): boolean {
  return process.env.PUBLISH_WORKBOOK_E2E === 'true';
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
