import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import type { FieldDependenciesResult } from '../../../../desktop/metadata/index.js';
import * as metadataModule from '../../../../desktop/metadata/index.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import {
  DesktopCommandExecutionError,
  FieldNotFoundError,
} from '../../../../errors/mcpToolError.desktop.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGetFieldDependenciesTool } from './getFieldDependencies.js';

vi.mock('../../../../desktop/metadata/index.js');
vi.mock('../../../../desktop/session/sessionResolution.js');
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');

const NOT_COVERED = [
  'dashboard actions',
  'groups or sets declared inside a worksheet, and set actions',
  'story points',
  'reference lines and table calculation addressing',
  'datasource filters and extracts',
  'published datasource internals',
  'anything outside the workbook XML',
];

function rootFor(datasource: string): FieldDependenciesResult['roots'][number] {
  const root = {
    id: `${datasource}\u0000Profit`,
    kind: 'field' as const,
    name: 'Profit',
    datasource,
  };
  return { root, nodes: [{ ...root, depth: 0 }], edges: [], cycles: [] };
}

function resultWith(roots: FieldDependenciesResult['roots']): FieldDependenciesResult {
  return {
    field: 'Profit',
    direction: 'dependents',
    ambiguous: roots.length > 1,
    summary: 'Changing Profit (east) affects no fields, no worksheets and no dashboards.',
    roots,
    notCovered: NOT_COVERED,
  };
}

describe('getFieldDependenciesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('4242'));
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok('<workbook />'));
    vi.mocked(metadataModule.getFieldDependencies).mockReturnValue(resultWith([rootFor('east')]));
  });

  it('defines a trimmed field, a described direction default and read-only annotations', async () => {
    const tool = getGetFieldDependenciesTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    const schema = z.object(paramsSchema);

    expect(tool.name).toBe('get-field-dependencies');
    expect(tool.description).toContain('live open workbook');
    expect(schema.parse({ field: '  Profit  ' })).toEqual({ field: 'Profit' });
    expect(() => schema.parse({ field: '   ' })).toThrow();
    expect(() => schema.parse({ field: 'Profit', direction: 'sideways' })).toThrow();
    expect(paramsSchema.direction.description).toContain('Omitted means dependents');
    expect(paramsSchema.datasource.description).toContain('Omitted searches every datasource');
    expect(paramsSchema.session.isOptional()).toBe(true);
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('resolves the session, reads the workbook once with the abort signal, and passes options', async () => {
    const controller = new AbortController();
    const extra = {
      ...getMockRequestHandlerExtra(),
      signal: controller.signal,
      getExecutor: vi.fn().mockResolvedValue({}),
    };

    const result = await getResult(
      { session: 'desktop-2', field: 'Profit', direction: 'dependencies', datasource: 'east' },
      extra,
    );

    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    expect(extra.getExecutor).toHaveBeenCalledWith('4242');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledWith({
      executor: {},
      signal: controller.signal,
    });
    expect(metadataModule.getFieldDependencies).toHaveBeenCalledWith('<workbook />', 'Profit', {
      direction: 'dependencies',
      datasource: 'east',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual(resultWith([rootFor('east')]));
    // A client that keeps only the structured block must still see every node and edge.
    expect(result.structuredContent).toEqual({
      ...resultWith([rootFor('east')]),
      nextAction: { label: 'Use this trace before changing the field', kind: 'prefill' },
    });
  });

  it('leaves direction unset so the analyzer applies the dependents default', async () => {
    await getResult({ field: 'Profit' });

    expect(metadataModule.getFieldDependencies).toHaveBeenCalledWith('<workbook />', 'Profit', {
      direction: undefined,
      datasource: undefined,
    });
  });

  it('returns both roots and the notCovered list when the name is ambiguous', async () => {
    vi.mocked(metadataModule.getFieldDependencies).mockReturnValue(
      resultWith([rootFor('east'), rootFor('west')]),
    );

    const result = await getResult({ field: 'Profit' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.ambiguous).toBe(true);
    expect(
      body.roots.map((root: { root: { datasource: string } }) => root.root.datasource),
    ).toEqual(['east', 'west']);
    expect(body.notCovered).toEqual(NOT_COVERED);
    expect(result.structuredContent).toMatchObject({
      ambiguous: true,
      roots: body.roots,
      notCovered: NOT_COVERED,
    });
  });

  it('maps zero roots to FieldNotFoundError', async () => {
    vi.mocked(metadataModule.getFieldDependencies).mockReturnValue(resultWith([]));

    const result = await getResult({ field: 'Missing', datasource: 'east' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const error = new FieldNotFoundError('Missing', 'east');
    expect(error.type).toBe('field-not-found');
    expect(error.statusCode).toBe(404);
    expect(result.content[0].text).toBe(error.message);
    expect(result.content[0].text).toContain('"Missing"');
    expect(result.structuredContent).toBeUndefined();
  });

  it('converts workbook read failures to DesktopCommandExecutionError', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'read-failed', message: 'workbook read failed', recoverable: false },
    };
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Err(error));

    const result = await getResult({ field: 'Profit' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
    expect(metadataModule.getFieldDependencies).not.toHaveBeenCalled();
  });
});

async function getResult(
  args: {
    session?: string;
    field: string;
    direction?: 'dependents' | 'dependencies';
    datasource?: string;
  },
  extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({}),
  },
): Promise<CallToolResult> {
  const tool = getGetFieldDependenciesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const parsedArgs = z.object(paramsSchema).parse(args);
  return await callback(
    {
      session: parsedArgs.session,
      field: parsedArgs.field,
      direction: parsedArgs.direction,
      datasource: parsedArgs.datasource,
    },
    extra,
  );
}
