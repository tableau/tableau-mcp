import { randomUUID } from 'crypto';
import { resolve } from 'path';
import { z } from 'zod';

import { getConfig } from '../../../src/config.js';
import { buildAuthConfig } from '../../../src/sdks/tableau/buildAuthConfig.js';
import { RestApi } from '../../../src/sdks/tableau/restApi.js';
import { publishedDataSourceResponseSchema } from '../../../src/sdks/tableau/types/dataSource.js';
import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { buildVariant } from '../build.js';
import { McpClient } from '../mcpClient.js';

const publishDatasourceResultSchema = z.object({
  status: z.literal('published'),
  data: publishedDataSourceResponseSchema,
  url: z.string(),
});

const defaultDatasourceFilePath = resolve('tests/e2e/fixtures/datasources/world-indicators.tdsx');
const defaultProjectId = 'd87d843b-4326-4ce3-bc50-a68c1e6c9ca5';
const runId = randomUUID();

// Unique names prevent concurrent CI jobs from overwriting each other's data sources.
// The test identity needs publish and delete permissions for the target project.
describe('publish-datasource local file', () => {
  let client: McpClient | undefined;
  const publishedDatasourceIds = new Set<string>();

  beforeAll(setEnv);

  beforeAll(async () => {
    await buildVariant('default');
    client = new McpClient({ env: getPublishDatasourceSmokeEnv() });
    await client.connect();
  });

  afterAll(async () => {
    try {
      if (publishedDatasourceIds.size > 0) {
        const config = getConfig();
        const authConfig = buildAuthConfig({
          config,
          tableauAuthInfo: undefined,
          scopes: new Set(['tableau:datasources:delete']),
        });
        if (!authConfig) throw new Error('Publish E2E cleanup requires a sign-in auth mode.');
        RestApi.host = config.server;
        const restApi = new RestApi({ maxRequestTimeoutMs: 10_000 });
        await restApi.signIn(authConfig);
        try {
          const results = await Promise.allSettled(
            [...publishedDatasourceIds].map((datasourceId) =>
              restApi.datasourcesMethods.deleteDatasource({
                siteId: restApi.siteId,
                datasourceId,
              }),
            ),
          );
          for (const result of results) expect(result.status).toBe('fulfilled');
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

  it('publishes a .tdsx data source from a local file path', async () => {
    const { datasourceFilePath, datasourceName, projectId } = getPublishDatasourceSmokeConfig();

    const publishResult = await client!.callTool('publish-datasource', {
      schema: publishDatasourceResultSchema,
      toolArgs: {
        datasourceFilePath,
        name: datasourceName,
        projectId,
        overwrite: false,
      },
    });

    // Only delete IDs returned for the unique name and project this test requested.
    expect(publishResult.data.name).toBe(datasourceName);
    expect(publishResult.data.project.id).toBe(projectId);
    publishedDatasourceIds.add(publishResult.data.id);

    expect(publishResult.status).toBe('published');
    expect(publishResult.url).toEqual(expect.any(String));
  });
});

function getPublishDatasourceSmokeConfig(): {
  datasourceFilePath: string;
  datasourceName: string;
  projectId: string;
} {
  return {
    datasourceFilePath:
      process.env.PUBLISH_DATASOURCE_E2E_FILE?.trim() || defaultDatasourceFilePath,
    datasourceName: `${process.env.PUBLISH_DATASOURCE_E2E_NAME?.trim() || 'Codex Publish Datasource E2E'} ${runId}`,
    projectId: process.env.PUBLISH_DATASOURCE_E2E_PROJECT_ID?.trim() || defaultProjectId,
  };
}

function getPublishDatasourceSmokeEnv(): Record<string, string> {
  return {
    ...getDefaultEnv(),
    FEATURE_GATE_PROVIDER: 'custom',
    FEATURE_GATE_PROVIDER_CONFIG: JSON.stringify({
      module: './tests/e2e/fixtures/authoringToolsFeatureGate.cjs',
    }),
  };
}
