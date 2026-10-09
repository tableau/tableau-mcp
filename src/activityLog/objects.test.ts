import { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';

import { WebMcpServer } from '../server.web.js';
import { testProductVersion } from '../testShared.js';
import { webToolNames } from '../tools/web/toolName.js';
import { webToolFactories } from '../tools/web/tools.js';
import { activityLogObjectSources, getActivityLogObject } from './objects.js';

// Building every tool reads the feature gate, which would otherwise look for features.json.
vi.mock('../features/init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: () => Promise.resolve(false) }),
}));

const LUID = '3659ece0-6edb-45ef-94e6-7b9cb1c7a1d3';

describe('activityLogObjectSources', () => {
  it('classifies every web tool', () => {
    expect(Object.keys(activityLogObjectSources).sort()).toEqual([...webToolNames].sort());
  });

  it('reads only arguments that the tool actually has', async () => {
    const tools = await Promise.all(
      webToolFactories.map((factory) => factory({} as unknown as WebMcpServer, testProductVersion)),
    );

    const checked: string[] = [];
    for (const tool of tools) {
      const source = activityLogObjectSources[tool.name];
      if (!source) {
        continue;
      }

      const schema = tool.paramsSchema as ZodRawShapeCompat | { shape: ZodRawShapeCompat };
      const argNames = Object.keys('shape' in schema ? schema.shape : schema);
      expect(argNames, tool.name).toEqual(expect.arrayContaining([...source.args]));
      checked.push(tool.name);
    }

    expect(checked.sort()).toEqual(
      Object.entries(activityLogObjectSources)
        .filter(([, source]) => source)
        .map(([name]) => name)
        .sort(),
    );
  });
});

describe('getActivityLogObject', () => {
  it.each([
    ['get-workbook', { workbookId: LUID }, { type: 'workbook', luid: LUID }],
    ['download-workbook', { workbookId: LUID }, { type: 'workbook', luid: LUID }],
    ['list-custom-views', { workbookId: LUID }, { type: 'workbook', luid: LUID }],
    ['get-view-image', { viewId: LUID, width: 800 }, { type: 'view', luid: LUID }],
    ['get-custom-view-data', { customViewId: LUID }, { type: 'custom-view', luid: LUID }],
    ['query-datasource', { datasourceLuid: LUID }, { type: 'datasource', luid: LUID }],
    ['describe-flow', { flowId: LUID }, { type: 'flow', luid: LUID }],
    ['run-flow-task', { taskId: LUID }, { type: 'flow-task', luid: LUID }],
    ['cancel-flow-run', { flowRunId: LUID }, { type: 'flow-run', luid: LUID }],
    ['update-user', { userId: LUID }, { type: 'user', luid: LUID }],
    [
      'update-cloud-extract-refresh-task',
      { taskId: LUID },
      { type: 'extract-refresh-task', luid: LUID },
    ],
    [
      'list-pulse-metrics-from-metric-definition-id',
      { pulseMetricDefinitionID: LUID },
      { type: 'pulse-metric-definition', luid: LUID },
    ],
    [
      'delete-content',
      { resourceType: 'extract-refresh-task', resourceId: LUID },
      { type: 'extract-refresh-task', luid: LUID },
    ],
    [
      'confirm-delete-content',
      { resourceType: 'datasource', resourceId: LUID },
      { type: 'datasource', luid: LUID },
    ],
    ['render-interactive-viz', { luid: LUID, objectType: 'view' }, { type: 'view', luid: LUID }],
    ['generate-insight-cards', { datasource: { luid: LUID } }, { type: 'datasource', luid: LUID }],
  ] as const)('%s: %j is %j', (toolName, args, expected) => {
    expect(getActivityLogObject(toolName, args)).toEqual(expected);
  });

  it('is undefined for a tool with no single object', () => {
    expect(getActivityLogObject('list-workbooks', { filter: 'name:eq:x' })).toBeUndefined();
    expect(getActivityLogObject('search-content', { terms: LUID })).toBeUndefined();
  });

  it('is undefined when the id the client passed is not a LUID', () => {
    expect(
      getActivityLogObject('query-datasource', { datasourceLuid: 'Superstore' }),
    ).toBeUndefined();
    expect(getActivityLogObject('get-workbook', { workbookId: '' })).toBeUndefined();
  });

  it('is undefined for the string form of generate-insight-cards, which is a content URL', () => {
    expect(getActivityLogObject('generate-insight-cards', { datasource: LUID })).toBeUndefined();
  });

  it('is undefined for a resource type that is not a known object type', () => {
    expect(
      getActivityLogObject('delete-content', { resourceType: 'project', resourceId: LUID }),
    ).toBeUndefined();
  });

  it('is undefined when the argument is missing or has the wrong type', () => {
    expect(getActivityLogObject('get-workbook', {})).toBeUndefined();
    expect(getActivityLogObject('get-workbook', { workbookId: 42 })).toBeUndefined();
  });

  it('is undefined, and does not throw, for args that are not an object', () => {
    expect(getActivityLogObject('get-workbook', undefined)).toBeUndefined();
    expect(getActivityLogObject('get-workbook', null)).toBeUndefined();
    expect(getActivityLogObject('get-workbook', 'x')).toBeUndefined();
    expect(getActivityLogObject('get-workbook', [LUID])).toBeUndefined();
  });
});
