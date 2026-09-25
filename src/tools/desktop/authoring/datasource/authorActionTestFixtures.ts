import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getAuthorActionTool, SourceFieldAggregation } from './authorAction.js';

// The single datasource every author-action test resolves fields against.
export const DATASOURCE_NAME = 'federated.1syzfv90anwuu119p4zra1ga299n';
export const DATASOURCE_CAPTION = 'Sample - Superstore';

// The datasource columns a filter action can resolve against, keyed by field caption.
const DATASOURCE_COLUMNS = {
  Profit:
    "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  Category:
    "<column caption='Category' datatype='string' name='[Category]' role='dimension' type='nominal' />",
  'Sub-Category':
    "<column caption='Sub-Category' datatype='string' name='[Sub-Category]' role='dimension' type='nominal' />",
  // Internal name carries sensitive characters '<', '>' and '&' to verify they're handled properly
  'Special Characters Field':
    "<column caption='Special Characters Field' datatype='string' name='[A &lt; B &gt; C &amp; D]' role='dimension' type='nominal' />",
} as const;

export type WorkbookField = keyof typeof DATASOURCE_COLUMNS;
export type WorkbookDashboard = { name: string; zones?: string[] };

// Builds a workbook document from its structured parts — the worksheets, any dashboards with their member zones,
// and any fields on the datasource that are needed
export function buildWorkbookXml({
  worksheets,
  dashboards = [],
  fields = ['Profit'],
}: {
  worksheets: string[];
  dashboards?: WorkbookDashboard[];
  fields?: WorkbookField[];
}): string {
  const columns = fields.map((field) => DATASOURCE_COLUMNS[field]).join('');
  const worksheetXml = worksheets.map((name) => `<worksheet name='${name}' />`).join('');
  const dashboardXml =
    dashboards.length === 0
      ? ''
      : `<dashboards>${dashboards.map(renderDashboard).join('')}</dashboards>`;
  return [
    "<?xml version='1.0' encoding='utf-8'?>",
    "<workbook version='18.1'>",
    '<datasources>',
    "<datasource hasconnection='false' inline='true' name='Parameters'>",
    "<column caption='p.Period' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column>",
    '</datasource>',
    `<datasource caption='${DATASOURCE_CAPTION}' name='${DATASOURCE_NAME}'>`,
    columns,
    '</datasource>',
    '</datasources>',
    `<worksheets>${worksheetXml}</worksheets>`,
    dashboardXml,
    '</workbook>',
  ].join('');
}

function renderDashboard({ name, zones }: WorkbookDashboard): string {
  if (zones === undefined || zones.length === 0) {
    return `<dashboard name='${name}' />`;
  }
  const zoneXml = zones.map((zone) => `<zone name='${zone}' />`).join('');
  return `<dashboard name='${name}'><zones>${zoneXml}</zones></dashboard>`;
}

export const BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource hasconnection='false' inline='true' name='Parameters'>",
  "<column caption='p.Period' datatype='string' name='[Parameter 1]' param-domain-type='list' role='measure' type='nominal' value='&quot;Month&quot;'><calculation class='tableau' formula='&quot;Month&quot;' /></column>",
  '</datasource>',
  "<datasource caption='Sample - Superstore' name='federated.1syzfv90anwuu119p4zra1ga299n'>",
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
  "<group caption='Category Set' name='[Category Set]' user:ui-builder='filter-group' />",
  "<group caption='Ad Hoc Group' name='[Ad Hoc Group]' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Profit' /></worksheets>",
  '</workbook>',
].join('');

// Splices an <actions> block in right after </datasources>, matching where the tool inserts it.
export function withActions(baseXml: string, actionXml: string): string {
  const dsClose = baseXml.indexOf('</datasources>') + '</datasources>'.length;
  return baseXml.slice(0, dsClose) + `<actions>${actionXml}</actions>` + baseXml.slice(dsClose);
}

export type AuthorActionArgs = {
  session?: string;
  mode?: 'parameter' | 'set' | 'url' | 'filter';
  caption: string;
  sourceWorksheet: string;
  sourceField?: string;
  targetParameter?: string;
  targetSet?: string;
  targetSheet?: string;
  filterFields?: string[];
  datasource?: string;
  setMembership?: 'assign' | 'add' | 'remove';
  clearSelection?: 'do-nothing' | 'show-all' | 'exclude-all';
  sourceFieldAggregation?: SourceFieldAggregation;
  clearValue?: string;
  singleSelect?: boolean;
  activation?: 'on-select' | 'on-hover' | 'on-menu';
  url?: string;
  sourceDashboard?: string;
  excludeSourceSheets?: string[];
  excludeTargetSheets?: string[];
  urlTarget?: 'default-zone-or-browser' | 'browser' | 'specific-zone';
  zoneId?: string;
  urlEncode?: boolean;
};

// Invokes author-action's callback directly against mocked External API calls
export async function getToolResult({
  args,
  initialXml = BASE_XML,
  readbackXml,
}: {
  args: AuthorActionArgs;
  initialXml?: string;
  readbackXml?: string;
}): Promise<{
  result: CallToolResult;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
}> {
  const documents = [initialXml, initialXml, readbackXml ?? initialXml];
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
  const tool = getAuthorActionTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const result = await callback(
    {
      session: '12345',
      ...args,
      mode: args.mode ?? 'parameter',
      sourceField: args.sourceField,
      targetParameter: args.targetParameter,
      targetSet: args.targetSet,
      targetSheet: args.targetSheet,
      filterFields: args.filterFields,
      datasource: args.datasource,
      singleSelect: args.singleSelect,
      activation: args.activation ?? 'on-select',
      setMembership: args.setMembership ?? 'assign',
      clearSelection: args.clearSelection ?? 'do-nothing',
      sourceFieldAggregation: args.sourceFieldAggregation,
      clearValue: args.clearValue,
      url: args.url,
      sourceDashboard: args.sourceDashboard,
      excludeSourceSheets: args.excludeSourceSheets,
      excludeTargetSheets: args.excludeTargetSheets,
      urlTarget: args.urlTarget,
      zoneId: args.zoneId,
      urlEncode: args.urlEncode,
    },
    extra,
  );

  return { result, applyWorkbookDocument };
}

// The XML handed to the first apply-workbook-document call.
export function appliedDocumentXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  const xml = applyWorkbookDocument.mock.calls[0]?.[0];
  invariant(typeof xml === 'string', 'applyWorkbookDocument was not called with document XML');
  return xml;
}
