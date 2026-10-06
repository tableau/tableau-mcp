import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';
import { z } from 'zod';

import { getConfig } from '../../../src/config.js';
import { buildAuthConfig } from '../../../src/sdks/tableau/buildAuthConfig.js';
import { RestApi } from '../../../src/sdks/tableau/restApi.js';
import { workbookSchema } from '../../../src/sdks/tableau/types/workbook.js';
import { validationIssueSchema } from '../../../src/sdks/tableau/types/workbookValidation.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';
import { getRestFailureDiagnostic, PublishWorkbookTestRun } from './publishWorkbookTestRun.js';

const publishWorkbookResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('published'),
    data: workbookSchema,
    url: z.string(),
    warnings: z.array(validationIssueSchema),
  }),
  z.object({
    status: z.literal('invalid'),
    errors: z.array(validationIssueSchema),
    warnings: z.array(validationIssueSchema),
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

// This live suite creates temporary workbooks and deletes only the returned IDs at teardown.
// Its identity must be allowed to publish and delete workbooks in the configured test project.
// PUBLISH_WORKBOOK_E2E_NAME is a prefix; every execution gets a unique suffix, including CI reruns.
describe('publish-workbook local file', () => {
  let client: McpClient | undefined;
  let testRun: PublishWorkbookTestRun;

  beforeAll(() => {
    setEnv();
    const { workbookName, projectId } = getPublishWorkbookSmokeConfig();
    testRun = new PublishWorkbookTestRun(workbookName, projectId);
  });

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getPublishWorkbookSmokeEnv() });
    client.client.setNotificationHandler(LoggingMessageNotificationSchema, ({ params }) => {
      const diagnostic = getRestFailureDiagnostic(params.data);
      if (diagnostic) console.error(`Publish E2E REST failure: ${diagnostic}`);
    });
    await client.connect();
  });

  afterAll(async () => {
    try {
      if (testRun?.hasPublishedWorkbooks) {
        const config = getConfig();
        const authConfig = buildAuthConfig({
          config,
          tableauAuthInfo: undefined,
          scopes: new Set(['tableau:workbooks:delete']),
        });
        if (!authConfig) throw new Error('Publish E2E cleanup requires a sign-in auth mode.');
        RestApi.host = config.server;
        const restApi = new RestApi({ maxRequestTimeoutMs: 10_000 });
        await restApi.signIn(authConfig);
        try {
          await testRun.cleanup((workbookId) =>
            restApi.workbooksMethods.deleteWorkbook({ siteId: restApi.siteId, workbookId }),
          );
        } finally {
          await restApi.signOut();
        }
      }
    } finally {
      try {
        await client?.close();
      } finally {
        resetEnv();
      }
    }
  }, 60_000);

  it('validates and publishes a workbook (.twb) from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    const workbookName = testRun.name('TWB');

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: smokeConfig.workbookFilePath,
        name: workbookName,
        projectId: smokeConfig.projectId,
        overwrite: false,
      },
    });

    expect(publishResult.status).toBe('published');
    if (publishResult.status === 'published') {
      testRun.track(publishResult.data);
      expect(publishResult.data.name).toBe(workbookName);
      expect(publishResult.url).toEqual(expect.any(String));
    }
  });

  it('validates and publishes a .twbx workbook from a local file path', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();
    const workbookName = testRun.name('TWBX');

    const publishResult = await client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: twbxWorkbookFilePath,
        name: workbookName,
        projectId: smokeConfig.projectId,
        overwrite: false,
      },
    });

    expect(publishResult.status).toBe('published');
    if (publishResult.status === 'published') {
      testRun.track(publishResult.data);
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
        name: testRun.name('Malformed TWB'),
        projectId: smokeConfig.projectId,
        overwrite: false,
      },
    });

    if (publishResult.status === 'published') testRun.track(publishResult.data);
    expect(publishResult.status).toBe('invalid');
    if (publishResult.status === 'invalid') {
      expect(publishResult.errors.length).toBeGreaterThan(0);
      // This fixture is structurally malformed XML (unclosed tag), which Tableau reports as a
      // generic parse error without line/column - unlike content-validation errors, which include
      // them.
      expect(publishResult.errors[0]).toMatchObject({
        severity: 'ERROR',
        message: expect.any(String),
        elementName: expect.any(String),
      });
      expect(publishResult.errors[0].line).toBeUndefined();
      expect(publishResult.errors[0].column).toBeUndefined();
    }
  });

  it('returns a publish error and does not publish a .twbx containing a malformed .twb', async () => {
    const smokeConfig = getPublishWorkbookSmokeConfig();

    const publish = client!.callTool('publish-workbook', {
      schema: publishWorkbookResultSchema,
      toolArgs: {
        workbookFilePath: malformedTwbxWorkbookFilePath,
        name: testRun.name('Bad TWBX'),
        projectId: smokeConfig.projectId,
        overwrite: false,
      },
    });
    const result = await publish.catch(() => undefined);
    if (result?.status === 'published') testRun.track(result.data);
    await expect(publish).rejects.toThrow(/status code 400|bad workbook|publish/i);
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
