import { exportedForTesting as serverExportedForTesting } from '../server.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { codeModeToolNames } from '../tools/toolName.js';

import { createCapabilityCatalog } from './capabilityCatalog.js';

const { Server } = serverExportedForTesting;

describe('capabilityCatalog', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a catalog from legacy tools only', async () => {
    const server = new Server();
    const catalog = await createCapabilityCatalog({ server });

    expect(catalog.operations.length).toBeGreaterThan(5);
    for (const codeModeToolName of codeModeToolNames) {
      expect(catalog.operations.find((operation) => operation.toolName === codeModeToolName)).toBeUndefined();
    }
  });

  it('creates operation ids and operation map', async () => {
    const server = new Server();
    const catalog = await createCapabilityCatalog({ server });
    const queryDatasource = catalog.operations.find(
      (operation) => operation.toolName === 'query-datasource',
    );

    expect(queryDatasource?.operationId).toBe('queryDatasource');
    expect(catalog.operationMap.queryDatasource).toBe('query-datasource');
    expect(queryDatasource?.summary.length).toBeGreaterThan(0);
    expect(queryDatasource?.requestBody?.content['application/json'].schema).toBeDefined();
    expect(queryDatasource?.examples?.minimalValidArgs).toEqual(
      expect.objectContaining({
        datasourceLuid: expect.any(String),
      }),
    );
    expect(queryDatasource?.examples?.fieldVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldCaption: 'Sales', function: 'SUM' }),
      ]),
    );
    expect(queryDatasource?.examples?.filterVariants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filterType: 'SET' }),
      ]),
    );
    expect(queryDatasource?.aliases).toEqual({ datasourceId: 'datasourceLuid' });
  });
});
