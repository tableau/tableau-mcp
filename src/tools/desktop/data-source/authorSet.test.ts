import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAuthorSetTool } from './authorSet.js';

const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters'>",
  "<column caption='p.Top N Sub-Category' datatype='integer' name='[Parameter 3]' param-domain-type='any' role='measure' type='quantitative' value='5'><calculation class='tableau' formula='5' /></column>",
  '</datasource>',
  "<datasource name='Sample - Superstore'>",
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets>",
  '</workbook>',
].join('');

const EMPTY_CATEGORY_SET_XML =
  "<group caption='Category Set' name='[Category Set]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter function='empty-level' member='[Category]' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' /></group>";

describe('authorSetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splices a param-linked Top-N group into the target datasource and verifies readback', async () => {
    const readbackXml = withGroup(
      BASE_XML,
      "<group caption='Top N Sub-Category Set' name='[Top N Sub-Category Set]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter count='[Parameters].[Parameter 3]' end='top' function='end' units='records' user:ui-marker='end' user:ui-top-by-field='true'><groupfilter direction='DESC' expression='SUM([Profit])' function='order' user:ui-marker='order'><groupfilter function='level-members' level='[Sub-Category]' user:ui-enumeration='all' user:ui-marker='enumerate' /></groupfilter></groupfilter></group>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Top N Sub-Category Set',
        dimension: 'Sub-Category',
        orderBy: 'SUM([Profit])',
        count: '[Parameters].[Parameter 3]',
        end: 'top',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      setName: '[Top N Sub-Category Set]',
      caption: 'Top N Sub-Category Set',
      datasource: 'Sample - Superstore',
      hint: 'reference it by caption in a bind-template ask, or as a filter/color field',
    });

    const appliedXml = appliedDocumentXml(applyWorkbookDocument);
    // The set lands in Superstore (NOT Parameters ds), param-link preserved verbatim.
    expect(appliedXml).toContain(
      "<group caption='Top N Sub-Category Set' name='[Top N Sub-Category Set]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter count='[Parameters].[Parameter 3]' end='top'",
    );
    expect(appliedXml).toContain("expression='SUM([Profit])'");
    expect(appliedXml).toContain("level='[Sub-Category]'");
  });

  it('emits the exact empty-level group shape for empty mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'empty',
        caption: 'Category Set',
        dimension: 'Category',
      },
      readbackXml: withGroup(BASE_XML, EMPTY_CATEGORY_SET_XML),
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toBe(
      withGroup(BASE_XML, EMPTY_CATEGORY_SET_XML),
    );
  });

  it.each(['orderBy', 'count'] as const)(
    'rejects empty mode when %s is supplied',
    async (signal) => {
      const { result, applyWorkbookDocument } = await getToolResult({
        args: {
          mode: 'empty',
          caption: 'Category Set',
          dimension: 'Category',
          [signal]: signal === 'orderBy' ? 'SUM([Profit])' : '5',
        },
      });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe('orderBy and count cannot be supplied in empty mode');
      expect(applyWorkbookDocument).not.toHaveBeenCalled();
    },
  );

  it('rejects empty mode when the set marker does not survive readback', async () => {
    const readbackWithoutMarker = withGroup(
      BASE_XML,
      "<group caption='Category Set' name='[Category Set]' name-style='unqualified'><groupfilter function='empty-level' member='[Category]' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' /></group>",
    );
    const { result } = await getToolResult({
      args: {
        mode: 'empty',
        caption: 'Category Set',
        dimension: 'Category',
      },
      readbackXml: readbackWithoutMarker,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('set name and caption survived readback');
    expect(result.content[0].text).toContain(
      "user:ui-builder='filter-group' marker did not survive readback",
    );
  });

  it('rejects top-n mode when the set marker does not survive readback', async () => {
    const readbackWithoutMarker = withGroup(
      BASE_XML,
      "<group caption='Top Categories' name='[Top Categories]' name-style='unqualified'><groupfilter count='5' end='top' function='end' units='records' user:ui-marker='end' user:ui-top-by-field='true'><groupfilter direction='DESC' expression='SUM([Profit])' function='order' user:ui-marker='order'><groupfilter function='level-members' level='[Category]' user:ui-enumeration='all' user:ui-marker='enumerate' /></groupfilter></groupfilter></group>",
    );
    const { result } = await getToolResult({
      args: {
        mode: 'top-n',
        caption: 'Top Categories',
        dimension: 'Category',
        orderBy: 'SUM([Profit])',
        count: '5',
      },
      readbackXml: readbackWithoutMarker,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('set name and caption survived readback');
    expect(result.content[0].text).toContain(
      "user:ui-builder='filter-group' marker did not survive readback",
    );
  });

  it('rejects a readback match from a different datasource', async () => {
    const twoDatasourceXml = BASE_XML.replace(
      "<datasource name='Sample - Superstore'>",
      "<datasource name='Datasource A'></datasource><datasource name='Datasource B'>",
    );
    const readbackXml = twoDatasourceXml.replace(
      "<datasource name='Datasource A'></datasource>",
      "<datasource name='Datasource A'><group caption='Shared' name='[Shared]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter function='empty-level' member='[Category]' user:ui-domain='database' user:ui-enumeration='inclusive' user:ui-marker='enumerate' /></group></datasource>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'empty',
        caption: 'Shared',
        dimension: 'Category',
        datasource: 'Datasource B',
      },
      initialXml: twoDatasourceXml,
      readbackXml,
    });

    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'readback did not contain the new set name and caption',
    );
  });

  it('creates an empty group that matches the author-action set resolver predicate', async () => {
    const { applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'empty',
        caption: 'Category Set',
        dimension: 'Category',
      },
      readbackXml: withGroup(BASE_XML, EMPTY_CATEGORY_SET_XML),
    });

    expect(isResolvableSet(appliedDocumentXml(applyWorkbookDocument), '[Category Set]')).toBe(true);
  });

  it('requires orderBy in top-n mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'top-n',
        caption: 'Top Categories',
        dimension: 'Category',
        count: '5',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('orderBy is required in top-n mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('requires count in top-n mode', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'top-n',
        caption: 'Top Categories',
        dimension: 'Category',
        orderBy: 'SUM([Profit])',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('count is required in top-n mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it.each(['0', '-1'])('rejects non-positive top-n count %s', async (count) => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'top-n',
        caption: 'Top Categories',
        dimension: 'Category',
        orderBy: 'SUM([Profit])',
        count,
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('count must be a positive integer in top-n mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric top-n count', async () => {
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        mode: 'top-n',
        caption: 'Top Categories',
        dimension: 'Category',
        orderBy: 'SUM([Profit])',
        count: 'many',
      },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe('count must be a positive integer in top-n mode');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects a caption collision before loading metadata', async () => {
    const xml = withGroup(
      BASE_XML,
      "<group caption='Existing Set' name='[Existing Set]' name-style='unqualified'><groupfilter function='level-members' level='[Sub-Category]' /></group>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Existing Set',
        dimension: 'Sub-Category',
        orderBy: 'SUM([Profit])',
        count: '5',
      },
      initialXml: xml,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption collision');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('accepts a bare integer count (fixed-N set, no param link)', async () => {
    const readbackXml = withGroup(
      BASE_XML,
      "<group caption='Bottom 3' name='[Bottom 3]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter count='3' end='bottom' function='end' units='records' user:ui-marker='end' user:ui-top-by-field='true'><groupfilter direction='DESC' expression='SUM([Profit])' function='order' user:ui-marker='order'><groupfilter function='level-members' level='[Sub-Category]' user:ui-enumeration='all' user:ui-marker='enumerate' /></groupfilter></groupfilter></group>",
    );
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Bottom 3',
        dimension: 'Sub-Category',
        orderBy: 'SUM([Profit])',
        count: '3',
        end: 'bottom',
      },
      readbackXml,
    });

    expect(result.isError).toBe(false);
    expect(appliedDocumentXml(applyWorkbookDocument)).toContain(
      "<groupfilter count='3' end='bottom'",
    );
  });

  it('rejects empty required primitives', async () => {
    const { result } = await getToolResult({
      args: { caption: '', dimension: 'Sub-Category', orderBy: 'SUM([Profit])', count: '5' },
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('caption empty');
  });

  it('splices legally into a REAL Desktop document at the datasource END (regression: relation columns are a position trap)', async () => {
    const realXml = readFileSync(
      join(
        process.cwd(),
        'src',
        'tools',
        'desktop',
        'data-source',
        '__fixtures__',
        'real-superstore-document.twb.xml',
      ),
      'utf8',
    );
    const groupXml =
      "<group caption='Replay Top N' name='[Replay Top N]' name-style='unqualified' user:ui-builder='filter-group'><groupfilter count='5' end='top' function='end' units='records' user:ui-marker='end' user:ui-top-by-field='true'><groupfilter direction='DESC' expression='SUM([Profit])' function='order' user:ui-marker='order'><groupfilter function='level-members' level='[Sub-Category]' user:ui-enumeration='all' user:ui-marker='enumerate' /></groupfilter></groupfilter></group>";
    const { result, applyWorkbookDocument } = await getToolResult({
      args: {
        caption: 'Replay Top N',
        dimension: 'Sub-Category',
        orderBy: 'SUM([Profit])',
        count: '5',
        end: 'top',
      },
      initialXml: realXml,
      readbackXml: realXml.replace('</datasource>', `${groupXml}</datasource>`),
    });

    expect(result.isError).toBe(false);
    const loaded = appliedDocumentXml(applyWorkbookDocument);
    const at = loaded.indexOf("caption='Replay Top N'");
    expect(at).toBeGreaterThan(-1);
    // Legal position: NOT inside a <relation>…</relation> block (the silent-discard trap).
    const relStart = loaded.lastIndexOf('<relation', at);
    const relEnd = relStart === -1 ? -1 : loaded.indexOf('</relation>', relStart);
    expect(relStart === -1 || relEnd < at).toBe(true);
    // Inside the datasources block.
    expect(at).toBeLessThan(loaded.indexOf('</datasources>'));
  });
});

function withGroup(baseXml: string, groupXml: string): string {
  // Insert the group just before Superstore's </datasource> close (mirrors the tool's splice).
  const superstoreOpen = baseXml.indexOf("<datasource name='Sample - Superstore'>");
  const close = baseXml.indexOf('</datasource>', superstoreOpen);
  return baseXml.slice(0, close) + groupXml + baseXml.slice(close);
}

type AuthorSetArgs = {
  session?: string;
  mode?: 'top-n' | 'empty';
  caption: string;
  dimension: string;
  orderBy?: string;
  count?: string;
  end?: 'top' | 'bottom';
  datasource?: string;
};

async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: AuthorSetArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, readbackXml ?? initialXml];
  let readCount = 0;
  const executeCommand = vi
    .fn()
    .mockResolvedValue(new Ok({ command_id: 'command-1', status: 'completed', result: null }));
  const getWorkbookDocument = vi.fn(async () => {
    return new Ok({
      xml: documents[Math.min(readCount++, documents.length - 1)],
      applicationVersion: undefined,
      xsdPayloadVersion: undefined,
    });
  });
  const applyWorkbookDocument = vi.fn(async () => {
    return new Ok({ command_id: 'apply-1', status: 'completed', result: null });
  });
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue({
      executeCommand,
      getWorkbookDocument,
      applyWorkbookDocument,
    }),
  };
  const tool = getAuthorSetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      mode: args.mode ?? 'top-n',
      orderBy: args.orderBy,
      count: args.count,
      end: args.end ?? 'top',
      datasource: args.datasource,
    },
    extra,
  );

  return { result, applyWorkbookDocument };
}

function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const [xml] = applyWorkbookDocument.mock.calls[0] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}

// Mirrors authorAction.resolveTargetSet's load-bearing group predicate without
// exporting that private implementation detail.
function isResolvableSet(xml: string, setName: string): boolean {
  return [...xml.matchAll(/<group\b[^>]*>/g)].some(
    (match) =>
      getAttr(match[0], 'name') === setName &&
      getAttr(match[0], 'user:ui-builder') === 'filter-group',
  );
}

function getAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`))?.[2];
}
