import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildAndApplyWorksheetTool } from './buildAndApplyWorksheet.js';

// CHARACTERIZATION SUITE — build-and-apply-worksheet consumer of the shared rewriter.
// ------------------------------------------------------------------------------------
// Pins the taskSpec → fieldMapping glue in buildAndApplyWorksheet.ts: how provided
// column refs are grouped by role and assigned, by INDEX, to the template's
// dimension/measure slots before the rewriter is called; plus how the datasource name
// is derived. W14-CM1 migrated this consumer OFF the deleted replaceFieldReferences
// wrapper and onto the shared core (`rewriteFieldReferences`). The session boundary
// (executor / loadWorksheetXml) is mocked, and the core is mocked so we can capture
// the exact (fieldMapping, datasource, metadata) the consumer constructs. The
// index-based slot assignment itself is UNCHANGED by the migration.

vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/templates/fieldReferenceRewriter.js');
vi.mock('../../../desktop/templates/templateColumnRequirements.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readFileSync } from 'fs';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { getTemplateColumnRequirements } from '../../../desktop/templates/templateColumnRequirements.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const SESSION = 'session-1';

// Worksheet-bearing string C "returns" so the consumer's worksheet-extraction regex
// and the (mocked) apply step succeed.
const WORKSHEET_OUTPUT =
  '<workbook><worksheets><worksheet name="TEMPLATE"><table/></worksheet></worksheets></workbook>';

const WORKBOOK_WITH_CAPTION = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore"/>
  </datasources>
</workbook>`;

// Field library shared by tests: two dimensions, two measures, all with metadata.
const FIELD_LIBRARY = [
  field('[DS].[none:Region:nk]', 'dimension', 'string', 'nominal'),
  field('[DS].[none:Segment:nk]', 'dimension', 'string', 'nominal'),
  field('[DS].[sum:Sales:qk]', 'measure', 'integer', 'quantitative'),
  field('[DS].[sum:Profit:qk]', 'measure', 'real', 'quantitative'),
];

function field(columnRef: string, role: string, datatype: string, type: string): any {
  return {
    column_ref: columnRef,
    role,
    datasource: 'Sample Superstore',
    columnName: columnRef,
    columnInstanceName: columnRef,
    derivation: 'None',
    type,
    datatype,
  };
}

function makeExtra(workbookXml = WORKBOOK_WITH_CAPTION): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(workbookXml as any);
  vi.mocked(readTemplate).mockReturnValue('<template/>');
  vi.mocked(listAvailableFields).mockReturnValue(FIELD_LIBRARY as any);
  // Default: 1 dimension slot + 2 measure slots.
  vi.mocked(getTemplateColumnRequirements).mockReturnValue([
    { name: 'Dim1', role: 'dimension', datatype: 'string', type: 'nominal' },
    { name: 'M1', role: 'measure', datatype: 'integer', type: 'quantitative' },
    { name: 'M2', role: 'measure', datatype: 'real', type: 'quantitative' },
  ]);
  vi.mocked(rewriteFieldReferences).mockReturnValue(WORKSHEET_OUTPUT);
  vi.mocked(loadWorksheetXml).mockResolvedValue(new Ok(undefined));
  return extra;
}

const TASK_SPEC_BASE = {
  worksheetName: 'Sheet1',
  worksheetFile: '/cache/worksheet.xml',
  type: 'chart' as const,
  template: 'chart',
  fields: [
    '[DS].[none:Region:nk]',
    '[DS].[none:Segment:nk]',
    '[DS].[sum:Sales:qk]',
    '[DS].[sum:Profit:qk]',
  ],
  workbookFile: '/cache/workbook.xml',
};

type Captured = {
  mapping: Record<string, string>;
  datasource: string;
  metadata: Record<string, { datatype: string; type: string }>;
};

function captureCall(): Captured {
  const captured: Captured = { mapping: {}, datasource: '', metadata: {} };
  vi.mocked(rewriteFieldReferences).mockImplementation((_xml, mapping, ds, meta) => {
    captured.mapping = mapping;
    captured.datasource = ds;
    captured.metadata = (meta ?? {}) as Captured['metadata'];
    return WORKSHEET_OUTPUT;
  });
  return captured;
}

// Parse the JSON success payload the tool returns (default getSuccessResult
// JSON-stringifies the Ok value), so warnings assertions can read the structured
// `warnings: string[]` field W14-CM1 added.
function parsePayload(result: CallToolResult): { warnings?: string[]; [k: string]: unknown } {
  const first = result.content[0];
  if (first.type !== 'text') throw new Error('expected a text content block');
  return JSON.parse(first.text);
}

describe('buildAndApplyWorksheetTool — mapping construction characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns dimension and measure fields to template slots by role, in field order (by index)', async () => {
    const extra = makeExtra();
    const captured = captureCall();

    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    // Dim slot 0 ← first dimension field; measure slots 0/1 ← measure fields in order.
    expect(captured.mapping).toEqual({
      Dim1: '[DS].[none:Region:nk]',
      M1: '[DS].[sum:Sales:qk]',
      M2: '[DS].[sum:Profit:qk]',
    });
  });

  it('CONVERGENCE: still index-drops extra role-matched fields, but now WARNS naming each one', async () => {
    // CONVERGENCE (W14-CM1): the index-based slot assignment is UNCHANGED — the loop
    // bound is still `i < slots.length && i < fields.length`, so the SECOND dimension
    // (Segment) is still dropped because the template exposes only one dimension slot.
    // What changed: the previously-SILENT drop (pinned by X1) now surfaces a
    // non-breaking `warnings[]` entry naming the dropped field.
    const extra = makeExtra();
    const captured = captureCall();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    // The single dimension slot took the FIRST dimension field; the second is gone.
    expect(captured.mapping.Dim1).toBe('[DS].[none:Region:nk]');
    expect(Object.values(captured.mapping)).not.toContain('[DS].[none:Segment:nk]');

    // ...and the drop is now visible in the result payload.
    const warnings = parsePayload(result).warnings ?? [];
    expect(warnings.some((w) => w.includes('[DS].[none:Segment:nk]'))).toBe(true);
  });

  it('CONVERGENCE: still drops unknown-role fields, but now WARNS naming each one', async () => {
    // CONVERGENCE (W14-CM1): a field whose column_ref is unknown to listAvailableFields
    // (so it gets no role) is still not assigned to any slot — but the drop is no
    // longer silent; it surfaces in `warnings[]`.
    const extra = makeExtra();
    const captured = captureCall();

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: [...TASK_SPEC_BASE.fields, '[DS].[none:Unknown:nk]'],
        },
      },
      extra,
    );

    expect(Object.values(captured.mapping)).not.toContain('[DS].[none:Unknown:nk]');

    const warnings = parsePayload(result).warnings ?? [];
    expect(warnings.some((w) => w.includes('[DS].[none:Unknown:nk]'))).toBe(true);
  });

  it('leaves surplus template slots unmapped when fewer role-matched fields are provided', async () => {
    const extra = makeExtra();
    const captured = captureCall();

    // Only one measure field provided; template still has M1 + M2 slots.
    await getResult(
      {
        session: SESSION,
        taskSpec: { ...TASK_SPEC_BASE, fields: ['[DS].[none:Region:nk]', '[DS].[sum:Sales:qk]'] },
      },
      extra,
    );

    expect(captured.mapping).toEqual({
      Dim1: '[DS].[none:Region:nk]',
      M1: '[DS].[sum:Sales:qk]',
    });
    expect(captured.mapping).not.toHaveProperty('M2');
  });

  it('populates fieldMetadata (datatype/type) for each mapped field', async () => {
    const extra = makeExtra();
    const captured = captureCall();

    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(captured.metadata).toEqual({
      Dim1: { datatype: 'string', type: 'nominal' },
      M1: { datatype: 'integer', type: 'quantitative' },
      M2: { datatype: 'real', type: 'quantitative' },
    });
  });

  it('CHARACTERIZATION: omits fieldMetadata for a mapped field missing datatype or type', async () => {
    // CHARACTERIZATION: current behavior — metadata is written only when BOTH
    // datatype and type are truthy, but the field is still added to the mapping. So
    // a field with blank metadata is mapped WITHOUT a corresponding metadata entry.
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      field('[DS].[none:Region:nk]', 'dimension', 'string', 'nominal'),
      field('[DS].[sum:Sales:qk]', 'measure', '', ''),
    ] as any);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Dim1', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'M1', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);
    const captured = captureCall();

    await getResult(
      {
        session: SESSION,
        taskSpec: { ...TASK_SPEC_BASE, fields: ['[DS].[none:Region:nk]', '[DS].[sum:Sales:qk]'] },
      },
      extra,
    );

    expect(captured.mapping).toHaveProperty('M1', '[DS].[sum:Sales:qk]');
    expect(captured.metadata).not.toHaveProperty('M1');
    expect(captured.metadata).toHaveProperty('Dim1');
  });

  it('derives the datasource name from the <datasource caption=...> when present', async () => {
    const extra = makeExtra();
    const captured = captureCall();

    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(captured.datasource).toBe('Sample - Superstore');
  });

  it('CHARACTERIZATION: without a caption, uses the first datasource name that is not "Parameters"', async () => {
    // CHARACTERIZATION: current behavior — caption wins; otherwise the first
    // non-"Parameters" datasource name is used (the literal "Parameters" datasource
    // is always skipped).
    const workbook =
      '<workbook><datasources>' +
      '<datasource name="Parameters"/>' +
      '<datasource name="Real DS"/>' +
      '</datasources></workbook>';
    const extra = makeExtra(workbook);
    const captured = captureCall();

    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(captured.datasource).toBe('Real DS');
  });

  it('applies the extracted worksheet through the mocked session boundary on success', async () => {
    const extra = makeExtra();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
    expect(result.isError).toBeFalsy();
  });

  it('CONVERGENCE: two applies namespace the template calc with DISTINCT nonces (no calc-name collision)', async () => {
    // CONVERGENCE (W14-CM1): end-to-end proof through the REAL shared core (not the
    // capture mock). A template calc column is namespaced per apply; because the
    // consumer mints a fresh nonce each apply, two applies of the SAME template into
    // the SAME workbook produce DISTINCT `_tpl_<suffix>` calc names — so a repeated
    // apply can't collide with / shadow the earlier apply's template calc.
    const actual = (await vi.importActual(
      '../../../desktop/templates/fieldReferenceRewriter.js',
    )) as typeof import('../../../desktop/templates/fieldReferenceRewriter.js');

    const CALC_TEMPLATE =
      '<workbook><worksheets><worksheet name="TEMPLATE"><table><view>' +
      '<datasource-dependencies datasource="{{DATASOURCE}}">' +
      '<column caption="Doubler" datatype="real" name="[MyCalc]" role="measure" type="quantitative">' +
      '<calculation class="tableau" formula="[Sales]*2" />' +
      '</column>' +
      '</datasource-dependencies>' +
      '</view></table></worksheet></worksheets></workbook>';

    const extra = makeExtra();
    // Feed the calc-bearing template and drive the REAL rewriter.
    vi.mocked(readTemplate).mockReturnValue(CALC_TEMPLATE);
    vi.mocked(readFileSync).mockReturnValue(WORKBOOK_WITH_CAPTION as any);
    vi.mocked(rewriteFieldReferences).mockImplementation(actual.rewriteFieldReferences);

    const capturedXml: string[] = [];
    vi.mocked(loadWorksheetXml).mockImplementation(async ({ xml }) => {
      capturedXml.push(xml);
      return new Ok(undefined);
    });

    // Two applies into the same workbook; no fields needed — we only exercise the calc.
    await getResult({ session: SESSION, taskSpec: { ...TASK_SPEC_BASE, fields: [] } }, extra);
    await getResult({ session: SESSION, taskSpec: { ...TASK_SPEC_BASE, fields: [] } }, extra);

    expect(capturedXml).toHaveLength(2);
    const suffix1 = capturedXml[0].match(/MyCalc_tpl_([0-9a-f]{8})/)?.[1];
    const suffix2 = capturedXml[1].match(/MyCalc_tpl_([0-9a-f]{8})/)?.[1];
    expect(suffix1).toBeTruthy();
    expect(suffix2).toBeTruthy();
    // Distinct per-apply nonces => distinct calc-name suffixes => no collision.
    expect(suffix1).not.toBe(suffix2);
  });
});

async function getResult(
  params: { session: string; taskSpec: typeof TASK_SPEC_BASE & { fields?: string[] } },
  extra: TableauDesktopRequestHandlerExtra,
): Promise<CallToolResult> {
  const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
