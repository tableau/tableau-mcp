import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildAndApplyWorksheetTool } from './buildAndApplyWorksheet.js';

vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/explicit-bind.js', async () => {
  const actual = await vi.importActual<typeof import('../../../desktop/binder/explicit-bind.js')>(
    '../../../desktop/binder/explicit-bind.js',
  );
  return { ...actual, bindExplicitTemplate: vi.fn(actual.bindExplicitTemplate) };
});
vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/templates/fieldReferenceRewriter.js');
vi.mock('../../../desktop/templates/templateColumnRequirements.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readdirSync, readFileSync } from 'fs';

import { bindExplicitTemplate } from '../../../desktop/binder/explicit-bind.js';
import { _resetManifestCache } from '../../../desktop/binder/manifest.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { deflectionText } from '../../../desktop/route/route-gate.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { getTemplateColumnRequirements } from '../../../desktop/templates/templateColumnRequirements.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const SESSION = 'session-1';
const FLAG = 'ROUTE_ENFORCEMENT';
const ORIGINAL_ROUTE_ENFORCEMENT = process.env[FLAG];

const WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore"/>
  </datasources>
</workbook>`;

const TWO_DATASOURCE_WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="DS_A" caption="First Caption"/>
    <datasource name="DS_B"/>
  </datasources>
</workbook>`;

const MILLER_WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource
      name="federated.0mkveh20xfko2115afimd1odnzrh"
      caption="worldcup-standings"
    >
      <column
        name="[country]"
        caption="Country"
        datatype="string"
        role="dimension"
        type="nominal"
      />
      <column
        name="[goalDifference]"
        caption="Goal Difference"
        datatype="integer"
        role="measure"
        type="quantitative"
      />
    </datasource>
  </datasources>
</workbook>`;

const TEMPLATE_XML =
  '<workbook><worksheets><worksheet name="TEMPLATE"><table/></worksheet></worksheets></workbook>';

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(WORKBOOK_XML as any);
  vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
  vi.mocked(listAvailableFields).mockReturnValue([
    {
      column_ref: '[DS].[sum:Sales:qk]',
      role: 'measure',
      datasource: 'Sample Superstore',
      columnName: '[Sales]',
      columnInstanceName: '[sum:Sales:qk]',
      derivation: 'Sum' as any,
      type: 'quantitative',
      datatype: 'integer',
    },
  ]);
  vi.mocked(getTemplateColumnRequirements).mockReturnValue([
    { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
  ]);
  vi.mocked(rewriteFieldReferences).mockReturnValue(TEMPLATE_XML);
  vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(WORKBOOK_XML));
  vi.mocked(loadWorksheetXml).mockResolvedValue(new Ok({ readbackWarnings: [] }));
  return extra;
}

function twoDatasourceFields(): any[] {
  return [
    {
      column_ref: '[DS_A].[none:Region:nk]',
      role: 'dimension',
      datasource: 'DS_A',
      columnName: '[Region]',
      columnInstanceName: '[none:Region:nk]',
      derivation: 'None' as any,
      type: 'nominal',
      datatype: 'string',
    },
    {
      column_ref: '[DS_B].[none:Region:nk]',
      role: 'dimension',
      datasource: 'DS_B',
      columnName: '[Region]',
      columnInstanceName: '[none:Region:nk]',
      derivation: 'None' as any,
      type: 'nominal',
      datatype: 'string',
    },
    {
      column_ref: '[DS_B].[sum:Sales:qk]',
      role: 'measure',
      datasource: 'DS_B',
      columnName: '[Sales]',
      columnInstanceName: '[sum:Sales:qk]',
      derivation: 'Sum' as any,
      type: 'quantitative',
      datatype: 'integer',
    },
  ];
}

const TASK_SPEC_BASE = {
  worksheetName: 'Sheet1',
  worksheetFile: '/cache/worksheet.xml',
  type: 'chart' as const,
  template: 'ranking-ordered-bar',
  fields: ['[DS].[sum:Sales:qk]'],
  workbookFile: '/cache/workbook.xml',
};

const promisedSortLossWarning: ReadbackFinding = {
  kind: 'sort',
  node: 'shelf-sort-v2',
  column: '[DS].[none:Region:nk]',
  intended: '<shelf-sort-v2 column="[DS].[none:Region:nk]">',
  readback: 'changed',
  severity: 'warning',
};

describe('buildAndApplyWorksheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('build-and-apply-worksheet');
    expect(tool.description).toBe(
      'Build a worksheet from a spec and apply it in one validated call.',
    );
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      taskSpec: expect.any(Object),
    });
  });

  it('should succeed and apply worksheet on happy path', async () => {
    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('HOST VERIFICATION');
    expect(readFileSync).toHaveBeenCalledWith(TASK_SPEC_BASE.workbookFile, 'utf-8');
    expect(getWorkbookXml).not.toHaveBeenCalled();
  });

  it('self-fetches the current workbook when workbookFile is omitted', async () => {
    const { workbookFile: _omitted, ...taskSpec } = TASK_SPEC_BASE;
    const extra = makeExtra();

    const result = await getResult({ session: SESSION, taskSpec }, extra);

    expect(result.isError).toBeFalsy();
    expect(getWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ executor: expect.any(Object), signal: extra.signal }),
    );
    expect(extra.getExecutor).toHaveBeenCalledTimes(1);
    expect(readFileSync).not.toHaveBeenCalled();
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('applies the waterfall anchor filter for P&L subtotal and total rows', async () => {
    const actualFs = await vi.importActual<typeof import('fs')>('fs');
    const actualRewriter = await vi.importActual<
      typeof import('../../../desktop/templates/fieldReferenceRewriter.js')
    >('../../../desktop/templates/fieldReferenceRewriter.js');
    const waterfallXml = actualFs.readFileSync(
      'src/desktop/data/templates/part-to-whole-waterfall.xml',
      'utf8',
    );
    const waterfallManifest = actualFs.readFileSync(
      'src/desktop/data/template-manifests/part-to-whole-waterfall.manifest.json',
      'utf8',
    );
    const workbookXml =
      '<workbook><datasources><datasource name="P&amp;L Data"/></datasources></workbook>';
    const extra = makeExtra();

    vi.mocked(readTemplate).mockReturnValue(waterfallXml);
    vi.mocked(readFileSync).mockImplementation((path) => {
      if (path === TASK_SPEC_BASE.workbookFile) return workbookXml;
      if (String(path).endsWith('part-to-whole-waterfall.manifest.json')) {
        return waterfallManifest;
      }
      throw new Error(`Unexpected read: ${String(path)}`);
    });
    vi.mocked(readdirSync).mockReturnValue(['part-to-whole-waterfall.manifest.json'] as any);
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[P&L Data].[none:line_item:nk]',
        role: 'dimension',
        datasource: 'P&L Data',
        columnName: '[line_item]',
        columnInstanceName: '[none:line_item:nk]',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[P&L Data].[sum:amount:qk]',
        role: 'measure',
        datasource: 'P&L Data',
        columnName: '[amount]',
        columnInstanceName: '[sum:amount:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'real',
      },
      {
        column_ref: '[P&L Data].[none:category:nk]',
        role: 'dimension',
        datasource: 'P&L Data',
        columnName: '[category]',
        columnInstanceName: '[none:category:nk]',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
    ]);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Sub-Category', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Profit', role: 'measure', datatype: 'real', type: 'quantitative' },
    ]);
    vi.mocked(rewriteFieldReferences).mockImplementation(actualRewriter.rewriteFieldReferences);
    let appliedXml = '';
    vi.mocked(loadWorksheetXml).mockImplementation(async ({ xml }) => {
      appliedXml = xml;
      return new Ok({ readbackWarnings: [] });
    });
    _resetManifestCache();

    try {
      const result = await getResult(
        {
          session: SESSION,
          taskSpec: {
            ...TASK_SPEC_BASE,
            template: 'part-to-whole-waterfall',
            fields: [
              '[P&L Data].[none:line_item:nk]',
              '[P&L Data].[sum:amount:qk]',
              '[P&L Data].[none:category:nk]',
            ],
          },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(appliedXml).toMatch(/<mark class=(['"])GanttBar\1\s*\/>/);
      expect(appliedXml).toMatch(/<table-calc\b[^>]*\btype=(['"])CumTotal\1/);
      expect(appliedXml).toMatch(/formula=(['"])-SUM\(\[amount\]\)\1/);
      expect(appliedXml).toContain(
        "<column datatype='string' name='[category]' role='dimension' type='nominal' />",
      );
      expect(appliedXml).toContain(
        "<filter class='categorical' column='[P&amp;L Data].[none:category:nk]'>",
      );
      expect(appliedXml).toContain("<groupfilter function='except'");
      expect(appliedXml).toContain("member='&quot;subtotal&quot;'");
      expect(appliedXml).toContain("member='&quot;total&quot;'");
    } finally {
      _resetManifestCache();
      vi.mocked(readdirSync).mockReset();
    }
  });

  it('returns an error before apply when every requested field is dropped', async () => {
    const result = await getResult({
      session: SESSION,
      taskSpec: { ...TASK_SPEC_BASE, fields: ['Country', 'Goal Difference'] },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('All requested fields were dropped');
    expect(result.content[0].text).toContain('"Country"');
    expect(result.content[0].text).toContain('"Goal Difference"');
    expect(result.content[0].text).toContain('resolve-field');
    expect(result.content[0].text).toContain('exact column_ref');
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('leads with dropped fields and fails host verification on a partial apply', async () => {
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[DS].[none:Region:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[Region]',
        columnInstanceName: '[none:Region:nk]',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[sum:Sales:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Sales]',
        columnInstanceName: '[sum:Sales:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'integer',
      },
    ]);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [],
        readbackVerification: { ok: true, status: 'passed' },
      }),
    );
    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['[DS].[none:Region:nk]', '[DS].[sum:Sales:qk]', 'Missing Field'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toMatch(/^WARNING — dropped requested field/);
    expect(payload.message).toContain('"Missing Field"');
    expect(payload.message).toContain('HOST VERIFICATION — failed');
    expect(payload.message).not.toContain('readback clean');
    expect(payload.message).not.toContain('preflight clean');
    expect(payload.message).not.toContain('Built and applied');
    expect(payload.fieldCount).toBe(2);
    expect(payload.requestedFieldCount).toBe(3);
  });

  it('reports correlation scatter coverage from manifest-consumed fields, not XML columns', async () => {
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[DS].[none:Customer Name:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[Customer Name]',
        columnInstanceName: '[none:Customer Name:nk]',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[none:Region:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[Region]',
        columnInstanceName: '[none:Region:nk]',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[sum:Sales:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Sales]',
        columnInstanceName: '[sum:Sales:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'real',
      },
      {
        column_ref: '[DS].[sum:Profit:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Profit]',
        columnInstanceName: '[sum:Profit:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'real',
      },
      {
        column_ref: '[DS].[sum:Quantity:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Quantity]',
        columnInstanceName: '[sum:Quantity:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'integer',
      },
    ]);
    // The XML has three measure-looking columns because one is a template-owned calc,
    // but the manifest exposes only two bindable measure slots.
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Customer Name', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'real', type: 'quantitative' },
      { name: 'Profit', role: 'measure', datatype: 'real', type: 'quantitative' },
      {
        name: 'Calculation_1368249927221915648',
        role: 'measure',
        datatype: 'real',
        type: 'quantitative',
      },
    ]);
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [],
        readbackVerification: { ok: true, status: 'passed' },
      }),
    );
    vi.mocked(bindExplicitTemplate).mockReturnValueOnce({
      ok: true,
      template: 'correlation-scatter-plot-chart',
      datasource: 'DS',
      fieldMapping: {
        Sales: '[DS].[sum:Sales:qk]',
        Profit: '[DS].[sum:Profit:qk]',
        'Customer Name': '[DS].[none:Customer Name:nk]',
        Region: '[DS].[none:Region:nk]',
      },
      fieldMetadata: {
        Sales: { datatype: 'real', type: 'quantitative' },
        Profit: { datatype: 'real', type: 'quantitative' },
        'Customer Name': { datatype: 'string', type: 'nominal' },
        Region: { datatype: 'string', type: 'nominal' },
      },
      consumedFieldRefs: [
        '[DS].[sum:Sales:qk]',
        '[DS].[sum:Profit:qk]',
        '[DS].[none:Customer Name:nk]',
        '[DS].[none:Region:nk]',
      ],
      templateSlots: [
        {
          slot_id: 'sales',
          template_field: 'Sales',
          derivation: 'sum',
          role: ['cols'],
          kind: 'quantitative',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'profit',
          template_field: 'Profit',
          derivation: 'sum',
          role: ['rows'],
          kind: 'quantitative',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'customer_name',
          template_field: 'Customer Name',
          derivation: 'none',
          role: ['detail'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
        {
          slot_id: 'region',
          template_field: 'Region',
          derivation: 'none',
          role: ['detail'],
          kind: 'categorical',
          bindable: true,
          required: true,
        },
      ],
      optionalFieldPrunes: [],
      warnings: [],
      passthrough: false,
    });

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          template: 'correlation-scatter-plot-chart',
          fields: [
            '[DS].[none:Customer Name:nk]',
            '[DS].[none:Region:nk]',
            '[DS].[sum:Sales:qk]',
            '[DS].[sum:Profit:qk]',
            '[DS].[sum:Quantity:qk]',
          ],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(bindExplicitTemplate).toHaveBeenCalledWith(
      'correlation-scatter-plot-chart',
      [
        '[DS].[none:Customer Name:nk]',
        '[DS].[none:Region:nk]',
        '[DS].[sum:Sales:qk]',
        '[DS].[sum:Profit:qk]',
        '[DS].[sum:Quantity:qk]',
      ],
      expect.any(Object),
      expect.any(Object),
    );
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toMatch(/^WARNING — dropped requested field/);
    expect(payload.message).toContain('"[DS].[sum:Quantity:qk]"');
    expect(payload.message).toContain('applied only with 4 of 5 requested fields');
    expect(payload.fieldCount).toBe(4);
    expect(payload.requestedFieldCount).toBe(5);
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Measure field "[DS].[sum:Quantity:qk]" was dropped: template "correlation-scatter-plot-chart" exposes only 2 measure slot(s).',
        ),
      ]),
    );
  });

  it('rejects a qualified ref whose base field exists but exact column_ref is missing', async () => {
    const wrongRef = '[DS].[avg:Sales:qk]';
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[DS].[sum:Sales:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Sales]',
        columnInstanceName: '[sum:Sales:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'integer',
      },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: [wrongRef, '[DS].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `Field "${wrongRef}" was dropped: its exact column_ref is not present; nearest valid column_ref is "[DS].[sum:Sales:qk]"`,
        ),
      ]),
    );
    const rewriteArgs = vi.mocked(rewriteFieldReferences).mock.calls[0];
    expect(rewriteArgs?.[1]).toEqual({ Sales: '[DS].[sum:Sales:qk]' });
    expect(JSON.stringify(rewriteArgs?.[1])).not.toContain(wrongRef);
  });

  it('resolves lowercase caption input against a title-cased field caption', async () => {
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[DS].[none:Country:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[Country]',
        columnInstanceName: '[none:Country:nk]',
        caption: 'Country',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[sum:Sales:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Sales]',
        columnInstanceName: '[sum:Sales:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'integer',
      },
    ]);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['country', '[DS].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      {
        Region: '[DS].[none:Country:nk]',
        Sales: '[DS].[sum:Sales:qk]',
      },
      'DS',
      {
        Region: { datatype: 'string', type: 'nominal' },
        Sales: { datatype: 'integer', type: 'quantitative' },
      },
      { namespaceCalcs: true, applyNonce: expect.any(String), templateSlots: [] },
    );
  });

  it('treats case-folded caption collisions as ambiguous', async () => {
    const extra = makeExtra();
    vi.mocked(listAvailableFields).mockReturnValue([
      {
        column_ref: '[DS].[none:Country:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[Country]',
        columnInstanceName: '[none:Country:nk]',
        caption: 'Country',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[none:country:nk]',
        role: 'dimension',
        datasource: 'DS',
        columnName: '[country]',
        columnInstanceName: '[none:country:nk]',
        caption: 'country',
        derivation: 'None' as any,
        type: 'nominal',
        datatype: 'string',
      },
      {
        column_ref: '[DS].[sum:Sales:qk]',
        role: 'measure',
        datasource: 'DS',
        columnName: '[Sales]',
        columnInstanceName: '[sum:Sales:qk]',
        derivation: 'Sum' as any,
        type: 'quantitative',
        datatype: 'integer',
      },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['COUNTRY', '[DS].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Field "COUNTRY" was dropped: its caption/local name is ambiguous across 2 fields',
        ),
      ]),
    );
    expect(vi.mocked(rewriteFieldReferences).mock.calls[0]?.[1]).toEqual({
      Sales: '[DS].[sum:Sales:qk]',
    });
  });

  it('resolves Miller caption-cased fields in the federated datasource', async () => {
    const extra = makeExtra();
    const actualMetadata = await vi.importActual<
      typeof import('../../../desktop/metadata/index.js')
    >('../../../desktop/metadata/index.js');
    vi.mocked(readFileSync).mockReturnValue(MILLER_WORKBOOK_XML as any);
    vi.mocked(listAvailableFields).mockImplementation(actualMetadata.listAvailableFields);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['Country', 'Goal Difference'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      {
        Region: '[federated.0mkveh20xfko2115afimd1odnzrh].[none:country:nk]',
        Sales: '[federated.0mkveh20xfko2115afimd1odnzrh].[sum:goalDifference:qk]',
      },
      'federated.0mkveh20xfko2115afimd1odnzrh',
      {
        Region: { datatype: 'string', type: 'nominal' },
        Sales: { datatype: 'integer', type: 'quantitative' },
      },
      { namespaceCalcs: true, applyNonce: expect.any(String), templateSlots: [] },
    );
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.fieldCount).toBe(2);
    expect(payload.warnings).not.toEqual(
      expect.arrayContaining([expect.stringContaining('was dropped')]),
    );
  });

  it('reports skipped readback caveat when apply succeeds without verification', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [],
        readbackVerification: { ok: true, status: 'skipped', message: 'worksheet busy' },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('HOST VERIFICATION — unverified');
    expect(result.content[0].text).toContain('readback unavailable');
    expect(result.content[0].text).not.toMatch(/\bverified\b/i);
  });

  it('fails the receipt when readback warnings show promised sort loss', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [promisedSortLossWarning],
        readbackVerification: { ok: true, status: 'warning' },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('HOST VERIFICATION — failed');
    expect(result.content[0].text).toContain('promised sort NOT verified');
    expect(result.content[0].text).not.toContain('HOST VERIFICATION — verified');
  });

  it('returns an error for an explicit workbook file that does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('workbook.xml');
    expect(getWorkbookXml).not.toHaveBeenCalled();
  });

  it('should return error when template is not provided', async () => {
    const result = await getResult({
      session: SESSION,
      taskSpec: { ...TASK_SPEC_BASE, template: '' },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('template is required');
  });

  it('should return error when template file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(readTemplate).mockReturnValue(null);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Template not found');
  });

  it('should return error when loadWorksheetXml fails', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Err({
        type: 'execute-command-error',
        error: {
          type: 'command-failed' as const,
          error: { code: 'E1', message: 'fail', recoverable: false },
        },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
  });

  it('should call rewriteFieldReferences with template, fieldMapping, resolved datasource, and namespacing options', async () => {
    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    // CONVERGENCE: build-and-apply now calls the shared core (rewriteFieldReferences)
    // directly instead of the deleted replaceFieldReferences wrapper, so the call
    // gains a 5th arg: the per-apply options object wiring calc namespacing ON with a
    // caller-minted nonce. Seam-1 packet B changes the datasource arg to the resolved
    // bind datasource instead of the workbook caption.
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      expect.any(Object),
      'DS',
      expect.any(Object),
      {
        namespaceCalcs: true,
        applyNonce: expect.any(String),
        templateSlots: expect.any(Array),
      },
    );
  });

  it('uses the explicit bind datasource for manifest-backed rewrites', async () => {
    const extra = makeExtra();
    vi.mocked(readFileSync).mockReturnValue(TWO_DATASOURCE_WORKBOOK_XML as any);
    vi.mocked(listAvailableFields).mockReturnValue(twoDatasourceFields() as any);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['[DS_B].[none:Region:nk]', '[DS_B].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      expect.any(Object),
      'DS_B',
      expect.any(Object),
      {
        namespaceCalcs: true,
        applyNonce: expect.any(String),
        templateSlots: expect.any(Array),
      },
    );
  });

  it('blocks no-manifest passthrough when provided refs span datasources', async () => {
    const extra = makeExtra();
    vi.mocked(readFileSync).mockReturnValue(TWO_DATASOURCE_WORKBOOK_XML as any);
    vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
    vi.mocked(listAvailableFields).mockReturnValue(twoDatasourceFields() as any);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          template: 'loose-template-without-manifest',
          fields: ['[DS_A].[none:Region:nk]', '[DS_B].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('BLOCKED: mixed-datasource field references');
    expect(result.content[0].text).toContain('DS_A');
    expect(result.content[0].text).toContain('DS_B');
    expect(rewriteFieldReferences).not.toHaveBeenCalled();
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('should return error when extracted worksheet element is missing from template', async () => {
    const extra = makeExtra();
    vi.mocked(rewriteFieldReferences).mockReturnValue('<workbook>no worksheet here</workbook>');

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('<worksheet>');
  });
});

describe('buildAndApplyWorksheetTool — focus-neutral apply contract', () => {
  it('does not pass the obsolete suppressFocus option', async () => {
    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    expect(loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet1' }),
    );
    expect(vi.mocked(loadWorksheetXml).mock.calls[0]?.[0]).not.toHaveProperty('suppressFocus');
  });
});

describe('buildAndApplyWorksheetTool — route gate (ROUTE_ENFORCEMENT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRouteState.clear();
    delete process.env[FLAG];
  });

  afterEach(() => {
    sessionRouteState.clear();
    if (ORIGINAL_ROUTE_ENFORCEMENT === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_ROUTE_ENFORCEMENT;
  });

  function seedPendingBindFirst(): void {
    sessionRouteState.recordAskClassification(SESSION, {
      ask: 'bar chart of sales by region',
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
    });
  }

  it('flag off executes normally even with a pending current_ask', async () => {
    seedPendingBindFirst();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on returns the deflection before reading workbook XML or applying worksheet', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    invariant(result.content[1].type === 'text');
    expect(JSON.parse(result.content[1].text)).toEqual({
      next_route: 'bind-first',
      template: 'ranking-ordered-bar',
    });
    expect(readFileSync).not.toHaveBeenCalled();
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('flag on deflects once, then an identical second call executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const first = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });
    const second = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(first.isError).toBe(false);
    invariant(first.content[0].type === 'text');
    expect(first.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(second.isError).toBeFalsy();
    invariant(second.content[0].type === 'text');
    expect(second.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on with no current_ask executes normally', async () => {
    process.env[FLAG] = 'on';

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on with an already-concluded current_ask executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();
    sessionRouteState.recordAskOutcome(SESSION, 'bar chart of sales by region', 'bound');

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });
});

async function getResult(
  params: {
    session: string;
    taskSpec: Omit<typeof TASK_SPEC_BASE, 'template' | 'workbookFile'> & {
      template?: string;
      workbookFile?: string;
    };
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
