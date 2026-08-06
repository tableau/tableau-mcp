import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import * as configModule from '../../../config.desktop.js';
import * as cacheFingerprintModule from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  buildInjectedWorkbookXml,
  removeSameNamedWorksheet,
} from '../../../desktop/templates/injectTemplateCore.js';
import * as runtimeCatalogModule from '../../../desktop/templates/runtimeTemplateCatalog.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInjectTemplateTool } from './injectTemplate.js';

vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/templates/runtimeTemplateCatalog.js');
vi.mock('../../../desktop/templates/injectTemplateCore.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../desktop/templates/injectTemplateCore.js')>();
  return { ...actual, buildInjectedWorkbookXml: vi.fn() };
});
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('fs');

import { existsSync, readFileSync, writeFileSync } from 'fs';

import * as discoveryModule from '../../../desktop/externalApi/discovery.js';
import { listTemplateNames } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const WORKBOOK_FILE = resolve('/cache/workbook.xml');
const SESSION = '12345';
const WORKBOOK_XML =
  '<?xml version="1.0"?><workbook><datasources><datasource name="Sample Superstore">' +
  '<column name="[Region]" role="dimension" type="nominal" datatype="string"/>' +
  '<column name="[Sales]" role="measure" type="quantitative" datatype="integer"/>' +
  '</datasource></datasources><worksheets/></workbook>';
const TWO_DATASOURCE_WORKBOOK_XML =
  '<?xml version="1.0"?><workbook><datasources>' +
  '<datasource name="DS_A"><column name="[Region]" role="dimension" type="nominal" datatype="string"/></datasource>' +
  '<datasource name="DS_B"><column name="[Region]" role="dimension" type="nominal" datatype="string"/><column name="[Sales]" role="measure" type="quantitative" datatype="integer"/></datasource>' +
  '</datasources><worksheets/></workbook>';
const TEMPLATE_XML =
  '<workbook><worksheets><worksheet name="{{TITLE}}"/></worksheets>' +
  '<windows><window class="worksheet" name="{{TITLE}}"/></windows></workbook>';
const INJECTED_XML =
  '<?xml version="1.0"?><workbook><worksheets><worksheet name="Sheet1"/></worksheets></workbook>';
const RUNTIME_SNAPSHOT = {
  template: 'ranking-ordered-bar',
  sourceHash: 'runtime-template-test',
  descriptor: {
    template: 'ranking-ordered-bar',
    slots: [
      {
        slot_id: 'region',
        template_field: 'Region',
        derivation: 'none' as const,
        role: ['rows'],
        kind: 'categorical' as const,
        bindable: true,
        required: true,
      },
      {
        slot_id: 'sales',
        template_field: 'Sales',
        derivation: 'sum' as const,
        role: ['cols'],
        kind: 'quantitative' as const,
        bindable: true,
        required: true,
      },
    ],
    calcs: [],
  },
  xml: TEMPLATE_XML,
  eligibility: { pass1_eligible: true, pass1_blockers: [] },
};

const BASE_PARAMS = {
  session: SESSION,
  workbookFile: WORKBOOK_FILE,
  templateName: 'ranking-ordered-bar',
  title: 'Sheet1',
  sheetType: 'worksheet' as const,
};

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(WORKBOOK_XML);
  vi.mocked(writeFileSync).mockImplementation(() => {});
  vi.mocked(runtimeCatalogModule.getRuntimeTemplateSnapshot).mockReturnValue(RUNTIME_SNAPSHOT);
  vi.mocked(listTemplateNames).mockReturnValue(['kpi-text', 'ranking-ordered-bar']);
  vi.mocked(buildInjectedWorkbookXml).mockReturnValue({ ok: true, xml: INJECTED_XML });
  return extra;
}

function mockPinnedSession(desktopSessionId: string | undefined): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    desktopSessionId,
  } as configModule.Config);
}

describe('injectTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPinnedSession(undefined);
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getInjectTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('inject-template');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      workbookFile: expect.any(Object),
      templateName: expect.any(Object),
      title: expect.any(Object),
      sheetType: expect.any(Object),
    });
  });

  it('should succeed and report injected sheet on happy path', async () => {
    const result = await getResult(BASE_PARAMS);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('Sheet1');
    expect(result.content[0].text).toContain('apply-workbook');
  });

  it('should write modified XML back to the workbook file', async () => {
    await getResult(BASE_PARAMS);

    expect(writeFileSync).toHaveBeenCalledWith(resolve(WORKBOOK_FILE), INJECTED_XML, 'utf-8');
  });

  it('writes a fingerprint sidecar after updating the workbook cache file', async () => {
    await getResult(BASE_PARAMS);

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(
      resolve(WORKBOOK_FILE),
      SESSION,
    );
  });

  it('stamps the sidecar with the pinned session, not the requested one', async () => {
    mockPinnedSession(SESSION);

    await getResult({ ...BASE_PARAMS, session: undefined as unknown as string });

    expect(cacheFingerprintModule.writeSidecar).toHaveBeenCalledWith(
      resolve(WORKBOOK_FILE),
      SESSION,
    );
  });

  it('rejects and writes no sidecar when the requested session is not a running instance', async () => {
    mockPinnedSession('99999');
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([
      { pid: 99999 } as ReturnType<typeof discoveryModule.discoverInstances>[number],
    ]);

    const result = await getResult(BASE_PARAMS);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(SESSION);
    expect(result.content[0].text).toContain('list-instances');
    expect(cacheFingerprintModule.writeSidecar).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should return error when workbook file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('should return error listing available templates when template file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(runtimeCatalogModule.getRuntimeTemplateSnapshot).mockReturnValue(null);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('"ranking-ordered-bar" not found');
    expect(result.content[0].text).toContain('kpi-text');
  });

  it('passes the runtime TBM snapshot and title to the shared inject core', async () => {
    await getResult(BASE_PARAMS);

    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ templateXml: TEMPLATE_XML, title: 'Sheet1' }),
    );
  });

  it('passes a validated explicit mapping to the shared inject core', async () => {
    await getResult({
      ...BASE_PARAMS,
      templateParameters: { DATASOURCE: 'Sample Superstore' },
      fieldMapping: { Region: '[none:Region:nk]', Sales: '[sum:Sales:qk]' },
    });

    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        templateParameters: { DATASOURCE: 'Sample Superstore' },
        fieldMapping: {
          Region: '[Sample Superstore].[none:Region:nk]',
          Sales: '[Sample Superstore].[sum:Sales:qk]',
        },
        templateSlots: RUNTIME_SNAPSHOT.descriptor.slots,
        applyNonce: expect.any(String),
      }),
    );
  });

  it('surfaces warnings returned by the shared inject core', async () => {
    const extra = makeExtra();
    vi.mocked(buildInjectedWorkbookXml).mockReturnValue({
      ok: true,
      xml: INJECTED_XML,
      warnings: ['computed-sort dropped: [DS].[sum:Missing:qk] did not resolve'],
    });

    const result = await getResult(
      {
        ...BASE_PARAMS,
        templateParameters: { DATASOURCE: 'Sample Superstore' },
        fieldMapping: { Region: '[none:Region:nk]', Sales: '[sum:Sales:qk]' },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Template advisory warnings:');
    expect(result.content[0].text).toContain(
      'computed-sort dropped: [DS].[sum:Missing:qk] did not resolve',
    );
  });

  it('blocks caller DATASOURCE when explicit mapping resolves to a different datasource', async () => {
    const extra = makeExtra();
    vi.mocked(readFileSync).mockReturnValue(TWO_DATASOURCE_WORKBOOK_XML);

    const result = await getResult(
      {
        ...BASE_PARAMS,
        templateParameters: { DATASOURCE: 'DS_A' },
        fieldMapping: {
          Region: '[DS_B].[none:Region:nk]',
          Sales: '[DS_B].[sum:Sales:qk]',
        },
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('[datasource-mismatch]');
    expect(result.content[0].text).toContain('DS_A');
    expect(result.content[0].text).toContain('DS_B');
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should return error when the shared inject core throws', async () => {
    const extra = makeExtra();
    vi.mocked(buildInjectedWorkbookXml).mockImplementation(() => {
      throw new Error('No <worksheets> container');
    });

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No <worksheets> container');
  });

  it('should return error and not write when the shared inject core rejects the result', async () => {
    const extra = makeExtra();
    vi.mocked(buildInjectedWorkbookXml).mockReturnValue({
      ok: false,
      issues: ['malformed template result'],
    });

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('passes custom template parameters to the shared inject core', async () => {
    await getResult({ ...BASE_PARAMS, templateParameters: { SUBTITLE: 'My Sub' } });

    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ templateParameters: { SUBTITLE: 'My Sub' } }),
    );
  });
});

async function getResult(
  params: typeof BASE_PARAMS & {
    templateParameters?: Record<string, string>;
    fieldMapping?: Record<string, string>;
    insertPosition?: 'end' | 'before_sheet' | 'after_sheet';
    relativeSheetName?: string;
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getInjectTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}

describe('removeSameNamedWorksheet — demo idempotence (W60)', () => {
  const wb = `<workbook>
  <worksheets>
    <worksheet name='Keep Me'>
      <table><rows /></table>
    </worksheet>
    <worksheet name='Bar of Sales'>
      <table><rows>[old]</rows></table>
    </worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='Bar of Sales'>
      <cards />
    </window>
    <window class='worksheet' name='Keep Me' />
  </windows>
</workbook>`;

  it('removes the same-named worksheet and its window so re-inject replaces instead of (1)-copying', () => {
    const out = removeSameNamedWorksheet(wb, 'Bar of Sales');
    expect(out).not.toMatch(/<worksheet name=['"]Bar of Sales['"]>/);
    expect(out).not.toMatch(/<window class=['"]worksheet['"] name=['"]Bar of Sales['"]/);
    expect(out).toMatch(/<worksheet name=['"]Keep Me['"]>/);
    expect(out).toMatch(/<window class=['"]worksheet['"] name=['"]Keep Me['"]\s*(\/>|><\/window>)/);
  });

  it('leaves the workbook unchanged when the sheet is referenced by a dashboard zone (fail-safe)', () => {
    const withDash = wb.replace(
      '</worksheets>',
      "</worksheets>\n  <dashboards><dashboard name='D'><zones><zone name='Bar of Sales' /></zones></dashboard></dashboards>",
    );
    expect(removeSameNamedWorksheet(withDash, 'Bar of Sales')).toBe(withDash);
  });

  it('no-ops when there is no name collision', () => {
    expect(removeSameNamedWorksheet(wb, 'Fresh Name')).toBe(wb);
  });
});
