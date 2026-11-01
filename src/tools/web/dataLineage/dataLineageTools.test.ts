import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import * as config from '../../../config.js';
import { parseFlowPackage } from '../../../sdks/tableau/methods/flowPackage.js';
import scriptFixtures from '../../../sdks/tableau/methods/prepScriptAnalysis.test.fixtures.json';
import { dataLineageParams, LineageOptions } from '../../../sdks/tableau/types/dataLineage.js';
import { WebMcpServer } from '../../../server.web.js';
import { DATA_LINEAGE_API_SCOPES, DESCRIBE_FLOW_API_SCOPES } from '../../../server/oauth/scopes.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAnalyzeDataImpactTool } from './analyzeDataImpact.js';
import { executeDataLineage } from './executeDataLineage.js';
import { getGetDataLineageTool } from './getDataLineage.js';
import { prepDocumentSha256 } from './prepSchemaObservations.js';

const mocks = vi.hoisted(() => ({
  graphql: vi.fn(),
  document: vi.fn(),
  content: vi.fn(),
  useRestApi: vi.fn(),
  flowAllowed: vi.fn(),
  enabled: true,
}));
vi.mock('../../../features/flowTools.js', () => ({
  isFlowReadToolsEnabled: async () => mocks.enabled,
  isFlowWriteToolsEnabled: async () => false,
}));
vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isFlowAllowed: mocks.flowAllowed,
    isDatasourceAllowed: async () => ({ allowed: true }),
    isWorkbookAllowed: async () => ({ allowed: true }),
    isViewAllowed: async () => ({ allowed: true }),
  },
}));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: (args: unknown) => mocks.useRestApi(args),
}));
const luid = '11111111-1111-4111-8111-111111111111';
const version = { value: '2026.3.0', build: '' };
const bounds = {
  projectIds: null,
  datasourceIds: null,
  workbookIds: null,
  viewIds: null,
  tags: null,
};
const page = (
  nodes: unknown[],
): { nodes: unknown[]; pageInfo: { hasNextPage: boolean; endCursor: null } } => ({
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null },
});
const args = (
  values: Record<string, unknown> = {},
): LineageOptions & { observedPrepSchemas: LineageOptions['observedPrepSchemas'] } => {
  const parsed = z.object(dataLineageParams).parse({ source: { type: 'flow', luid }, ...values });
  return { ...parsed, observedPrepSchemas: parsed.observedPrepSchemas };
};
const extra = (disableMetadataApiRequests = false): ReturnType<typeof getMockRequestHandlerExtra> =>
  getMockRequestHandlerExtra({
    getConfigWithOverrides: vi
      .fn()
      .mockResolvedValue({ boundedContext: bounds, disableMetadataApiRequests }),
  });
function parsed(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content.type !== 'text') throw new Error('Expected text result');
  return JSON.parse(content.text);
}

describe('data lineage tools and optional document guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.flowAllowed.mockResolvedValue({ allowed: true });
    mocks.document.mockResolvedValue({ nodes: {} });
    mocks.graphql.mockImplementation(async () => ({
      data: { asset: page([{ id: 'f', __typename: 'Flow', luid }]) },
    }));
    mocks.useRestApi.mockImplementation(async ({ callback }) =>
      callback({
        metadataMethods: { graphql: mocks.graphql },
        flowDocumentMethods: { getFlowDocument: mocks.document },
        flowsMethods: { downloadFlowContent: mocks.content },
        siteId: 'site',
      }),
    );
  });
  it('declares both tools read-only with the catalog scope maximum', () => {
    for (const tool of [
      getGetDataLineageTool(new WebMcpServer(), version),
      getAnalyzeDataImpactTool(new WebMcpServer(), version),
    ]) {
      expect(tool.requiredApiScopes).toEqual([...DATA_LINEAGE_API_SCOPES]);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
  });
  it('runs Metadata-only calls without documents or download JWT scopes', async () => {
    const graph = await executeDataLineage(args(), extra(), version);
    expect(graph.resolution).toBe('resolved');
    expect(mocks.document).not.toHaveBeenCalled();
    expect(mocks.useRestApi).toHaveBeenCalledTimes(1);
    expect(mocks.useRestApi.mock.calls[0][0].jwtScopes).not.toContain('tableau:flows:download');
  });
  it('treats source-bound observations as an explicit document request and retains the download grant', async () => {
    const document = { nodes: { s: { id: 's', nodeType: '.v1.LoadCsv' } } };
    mocks.document.mockResolvedValue(document);
    const graph = await executeDataLineage(
      args({
        observedPrepSchemas: [
          {
            documentSha256: prepDocumentSha256(document),
            nodeId: 's',
            fields: [{ name: 'Amount', type: 'real' }],
          },
        ],
      }),
      extra(),
      version,
    );
    expect(mocks.document).toHaveBeenCalledTimes(1);
    expect(
      mocks.useRestApi.mock.calls.some(([call]) =>
        call.jwtScopes.includes('tableau:flows:download'),
      ),
    ).toBe(true);
    expect(graph.prepDetails?.[0].fieldAnalysis?.appliedSchemaObservations).toBe(1);
  });
  it.each(['stdio', 'http'] as const)(
    'rejects unconfigured/remote local access on %s without Tableau calls',
    async (transport) => {
      const spy = vi.spyOn(config, 'getConfig').mockReturnValue({
        ...config.getConfig(),
        transport,
        localFlowRoots: transport === 'stdio' ? [] : ['C:/Prep'],
      });
      const context = extra();
      try {
        const graph = await executeDataLineage(
          args({ source: { type: 'local-flow', path: 'C:/Prep/flow.tfl' } }),
          context,
          version,
        );
        expect(graph.resolution).toBe('not-allowed');
        expect(graph.coverage.requests).toBe(0);
        expect(mocks.useRestApi).not.toHaveBeenCalled();
        expect(context.getConfigWithOverrides).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    },
  );
  it('mints optional download scopes only after flow authorization', async () => {
    await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
    expect(mocks.document).toHaveBeenCalledWith({ siteId: 'site', flowId: luid });
    expect(mocks.useRestApi.mock.calls[1][0].jwtScopes).toEqual(DESCRIBE_FLOW_API_SCOPES);
  });
  it('reserves one request for explicitly requested source Flow details within the total budget', async () => {
    const graph = await executeDataLineage(
      args({ includePrepDetails: true, maxRequests: 2 }),
      extra(),
      version,
    );
    expect(graph.resolution).toBe('resolved');
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    expect(mocks.document).toHaveBeenCalledTimes(1);
    expect(graph.coverage.requests).toBe(2);
    expect(graph.prepDetails).toHaveLength(1);
    expect(graph.warnings.some((w) => w.code === 'REQUEST_LIMIT')).toBe(true);
  });
  it('retains a document request when a selected field discovers its Prep producer', async () => {
    const field = { id: 'field', __typename: 'ColumnField' };
    const output = { id: 'output', __typename: 'FlowFieldOutputField', flow: [{ id: 'f', luid }] };
    mocks.graphql.mockImplementation(async (query: string) => {
      const owner: Record<string, unknown> = { ...field };
      for (const [, alias, relation] of query.matchAll(/(r\d+): (\w+)/g)) {
        owner[alias] = relation.endsWith('Connection')
          ? page(relation === 'referencedByFlowFieldOutputFieldConnection' ? [output] : [])
          : null;
      }
      return { data: { asset: page([owner]) } };
    });
    const graph = await executeDataLineage(
      args({
        source: { type: 'field', id: 'field' },
        direction: 'upstream',
        includePrepDetails: true,
        maxRequests: 3,
      }),
      extra(),
      version,
    );
    expect(mocks.graphql).toHaveBeenCalledTimes(2);
    expect(mocks.document).toHaveBeenCalledWith({ siteId: 'site', flowId: luid });
    expect(graph.coverage.requests).toBe(3);
    expect(graph.prepDetails).toHaveLength(1);
  });
  it('does not exceed a one-request budget even when source Flow details are requested', async () => {
    const graph = await executeDataLineage(
      args({ includePrepDetails: true, maxRequests: 1 }),
      extra(),
      version,
    );
    expect(mocks.graphql).toHaveBeenCalledTimes(1);
    expect(mocks.document).not.toHaveBeenCalled();
    expect(graph.coverage.requests).toBe(1);
    expect(graph.coverage.prep).toBe('unavailable');
    expect(graph.warnings.some((w) => w.code === 'REQUEST_LIMIT')).toBe(true);
  });
  it('retains catalog results without calling an unavailable older-version endpoint', async () => {
    const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), {
      value: '2026.2.0',
      build: '',
    });
    expect(graph.resolution).toBe('resolved');
    expect(graph.coverage.prep).toBe('unavailable');
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it.each([403, 404, 500])(
    'keeps Metadata results and marks optional HTTP %s documents unknown',
    async (status) => {
      mocks.document.mockRejectedValue(
        Object.assign(new Error('DO_NOT_ECHO'), {
          isAxiosError: true,
          response: { status, data: { secret: 'DO_NOT_ECHO' } },
        }),
      );
      const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
      expect(graph.resolution).toBe('resolved');
      expect(graph.coverage.prep).toBe('unavailable');
      expect(graph.warnings.some((w) => w.code === 'PREP_DOCUMENT_UNAVAILABLE')).toBe(true);
      expect(JSON.stringify(graph)).not.toContain('DO_NOT_ECHO');
    },
  );
  it('downloads nothing when the boundary changes before the optional read', async () => {
    mocks.flowAllowed
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });
    const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
    expect(mocks.document).not.toHaveBeenCalled();
    expect(graph.warnings.some((w) => w.code === 'PREP_DOCUMENT_FILTERED')).toBe(true);
  });
  it('distinguishes the specific disabled-API code without echoing server details', async () => {
    mocks.document.mockRejectedValue(
      Object.assign(new Error('PRIVATE_RESPONSE'), {
        isAxiosError: true,
        response: { status: 403, data: { error: { code: '403201' } } },
      }),
    );
    const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
    expect(
      graph.warnings.some(
        (w) =>
          w.code === 'PREP_DOCUMENT_DISABLED' &&
          w.message.includes('features.getFlowDocumentRestApi'),
      ),
    ).toBe(true);
    expect(JSON.stringify(graph)).not.toContain('PRIVATE_RESPONSE');
  });
  it('honors cancellation while an optional document request fails', async () => {
    const abort = new AbortController();
    mocks.document.mockImplementationOnce(() => {
      abort.abort();
      throw new Error('cancelled');
    });
    await expect(
      executeDataLineage(
        args({ includePrepDetails: true }),
        { ...extra(), signal: abort.signal },
        version,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('honors disabled Metadata and Prep configurations without hidden requests', async () => {
    expect((await executeDataLineage(args(), extra(true), version)).resolution).toBe('unavailable');
    expect(mocks.useRestApi).not.toHaveBeenCalled();
    mocks.enabled = false;
    expect((await executeDataLineage(args(), extra(), version)).resolution).toBe('not-allowed');
    expect(mocks.useRestApi).not.toHaveBeenCalled();
  });
  it('never leaves a flow origin when the requested internal-field document is unavailable', async () => {
    mocks.document.mockRejectedValue(new Error('no document'));
    const graph = await executeDataLineage(
      args({ source: { type: 'prep-field', flowLuid: luid, stepId: 's', name: 'Sales' } }),
      extra(),
      version,
    );
    expect(graph.sourceId).toBeUndefined();
    expect(graph.resolution).toBe('unavailable');
  });
  it('accepts Workbook content-change through the real public callback schema and keeps only downstream impact', async () => {
    mocks.graphql.mockImplementation(async () => ({
      data: { asset: page([{ id: 'w', __typename: 'Workbook', luid }]) },
    }));
    const tool = getAnalyzeDataImpactTool(new WebMcpServer(), version);
    const result = parsed(
      await (
        await Provider.from(tool.callback)
      )({ ...args({ source: { type: 'workbook', luid } }), change: 'content-change' }, extra()),
    );
    expect(result.resolution).toBe('resolved');
    expect(result.direction).toBe('downstream');
    expect(result.change).toBe('content-change');
  });
  it('executes public callbacks through the normal result funnel and keeps impact downstream', async () => {
    const server = new WebMcpServer();
    const lineage = getGetDataLineageTool(server, version),
      impact = getAnalyzeDataImpactTool(server, version);
    const result = parsed(await (await Provider.from(lineage.callback))(args(), extra()));
    expect(result.resolution).toBe('resolved');
    const impactResult = parsed(
      await (
        await Provider.from(impact.callback)
      )({ ...args(), change: 'delete' }, extra()),
    );
    expect(impactResult.direction).toBe('downstream');
    expect(impactResult.change).toBe('delete');
    expect(impactResult.impacts).toEqual([]);
  });
  it.each(['python', 'r'] as const)(
    'reads %s attachment metadata through the real tool callback and existing download scope',
    async (language) => {
      const content = Buffer.from(scriptFixtures[language], 'base64');
      mocks.content.mockResolvedValue(content);
      mocks.document.mockResolvedValue(parseFlowPackage(content).document);
      const graph = await executeDataLineage(
        args({ includePrepDetails: true, maxNodes: 500 }),
        extra(),
        version,
      );
      expect(mocks.content).toHaveBeenCalledWith(
        expect.objectContaining({ flowId: luid, siteId: 'site' }),
      );
      expect(mocks.useRestApi.mock.calls.at(-1)?.[0].jwtScopes).toEqual(DESCRIBE_FLOW_API_SCOPES);
      expect(graph.prepDetails?.[0].externalSteps?.[0]).toMatchObject({
        usedFields: ['Price', 'Qty'],
        schemaStatus: 'static-declaration',
        settings: { language, function: 'transform' },
      });
      expect(JSON.stringify(graph)).not.toMatch(/NEVER_RETURN|import pandas|transform\.py/);
    },
  );
  it('does not download attachments for metadata-only requests or outside the request budget', async () => {
    mocks.document.mockResolvedValue(
      parseFlowPackage(Buffer.from(scriptFixtures.python, 'base64')).document,
    );
    await executeDataLineage(args({ includePrepDetails: false }), extra(), version);
    expect(mocks.content).not.toHaveBeenCalled();
    const graph = await executeDataLineage(
      args({ includePrepDetails: true, maxRequests: 2 }),
      extra(),
      version,
    );
    expect(mocks.content).not.toHaveBeenCalled();
    expect(graph.coverage.requests).toBeLessThanOrEqual(2);
  });
  it('rechecks the Flow owner immediately before the optional package download', async () => {
    mocks.document.mockResolvedValue(
      parseFlowPackage(Buffer.from(scriptFixtures.python, 'base64')).document,
    );
    mocks.flowAllowed.mockImplementation(async () => ({
      allowed: mocks.document.mock.calls.length === 0,
    }));
    const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
    expect(mocks.document).toHaveBeenCalled();
    expect(mocks.content).not.toHaveBeenCalled();
    expect(
      graph.warnings.some((warning) => warning.code === 'PREP_SCRIPT_PACKAGE_UNAVAILABLE'),
    ).toBe(true);
  });
  it('retains catalog and document evidence after a package failure without leaking its contents', async () => {
    mocks.document.mockResolvedValue(
      parseFlowPackage(Buffer.from(scriptFixtures.python, 'base64')).document,
    );
    mocks.content.mockRejectedValue(new Error('NEVER_RETURN_PRIVATE_ERROR'));
    const graph = await executeDataLineage(args({ includePrepDetails: true }), extra(), version);
    expect(graph.resolution).toBe('resolved');
    expect(
      graph.warnings.some((warning) => warning.code === 'PREP_SCRIPT_PACKAGE_UNAVAILABLE'),
    ).toBe(true);
    expect(JSON.stringify(graph)).not.toContain('NEVER_RETURN');
  });
});
