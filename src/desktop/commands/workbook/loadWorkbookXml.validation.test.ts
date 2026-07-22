import { readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { buildInjectedWorkbookXml } from '../../templates/injectTemplateCore.js';
import { ToolExecutor } from '../../toolExecutor/toolExecutor.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

describe('loadWorkbookXml validation preflight', () => {
  it('Miller World Cup repro: default-named parameters apply with telemetry warnings', async () => {
    const xml = `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource name='Parameters'>
      <column name='[Parameter 1]' role='measure' type='quantitative' datatype='integer' param-domain-type='any'>
        <calculation class='tableau' formula='5' />
      </column>
      <column name='[Parameter 2]' role='measure' type='quantitative' datatype='integer' param-domain-type='any'>
        <calculation class='tableau' formula='10' />
      </column>
    </datasource>
  </datasources>
  <worksheets><worksheet name='World Cup Countries'><table /></worksheet></worksheets>
  <windows><window class='worksheet' name='World Cup Countries' /></windows>
</workbook>`;
    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }));
    const executor = { applyWorkbookDocument } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
      xml,
      executor,
      signal: new AbortController().signal,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'calc-field-names',
            severity: 'warning',
            message: expect.stringContaining('[Parameter 1]'),
          }),
          expect.objectContaining({
            ruleId: 'calc-field-names',
            severity: 'warning',
            message: expect.stringContaining('[Parameter 2]'),
          }),
        ]),
      );
    }
  });

  it('Miller-shaped bound ranking template passes whole-workbook preflight', async () => {
    const datasource = 'federated.0mkveh20xfko2115afimd1odnzrh';
    const workbookXml = `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource hasconnection='false' inline='true' name='Parameters'>
      <column name='[Parameter 1]' role='measure' type='quantitative' datatype='integer' param-domain-type='any'>
        <calculation class='tableau' formula='5' />
      </column>
      <column name='[Parameter 2]' role='measure' type='quantitative' datatype='integer' param-domain-type='any'>
        <calculation class='tableau' formula='10' />
      </column>
    </datasource>
    <datasource inline='true' name='${datasource}'>
      <connection class='federated'>
        <named-connections>
          <named-connection caption='worldcup-standings.csv' name='textscan.0mkveh20xfko2115afimd1odnzrh'>
            <connection class='textscan' directory='/tmp' filename='worldcup-standings.csv' />
          </named-connection>
        </named-connections>
      </connection>
      <column caption='Country' datatype='string' name='[country]' role='dimension' type='nominal' />
      <column caption='Goal Difference' datatype='integer' name='[goalDifference]' role='measure' type='quantitative' />
      <column caption='Number of Records' datatype='integer' name='[Number of Records]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='1' />
      </column>
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='Sheet 6'>
      <table>
        <view>
          <datasources>
            <datasource caption='worldcup-standings.csv' name='${datasource}'>
              <connection class='textscan' />
            </datasource>
          </datasources>
        </view>
      </table>
    </worksheet>
  </worksheets>
  <windows><window class='worksheet' name='Sheet 6' /></windows>
</workbook>`;
    const templateXml = readFileSync(
      join(process.cwd(), 'src/desktop/data/templates/ranking-ordered-bar.xml'),
      'utf8',
    );
    const injected = buildInjectedWorkbookXml({
      workbookXml,
      templateXml,
      title: 'World Cup Countries by Goal Difference',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: datasource },
      fieldMapping: {
        Region: `[${datasource}].[none:country:nk]`,
        Sales: `[${datasource}].[sum:goalDifference:qk]`,
      },
      applyNonce: 'miller-world-cup',
    });
    expect(injected.ok).toBe(true);
    invariant(injected.ok);

    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }));
    const executor = { applyWorkbookDocument } as unknown as ToolExecutor;
    const result = await loadWorkbookXml({
      xml: injected.xml,
      executor,
      signal: new AbortController().signal,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    const appliedXml = applyWorkbookDocument.mock.calls[0][0] as string;
    expect(appliedXml).toContain('name="textscan.0mkveh20xfko2115afimd1odnzrh"');
    expect(appliedXml).toContain('filename="worldcup-standings.csv"');
    expect(appliedXml).toContain('name="World Cup Countries by Goal Difference"');
    if (result.isOk()) {
      expect(result.value.validationWarnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'calc-field-names',
            message: expect.stringContaining('[Parameter 1]'),
          }),
          expect.objectContaining({
            ruleId: 'calc-field-names',
            message: expect.stringContaining('[Parameter 2]'),
          }),
          expect.objectContaining({
            ruleId: 'calc-field-names',
            message: expect.stringContaining('[Number of Records]'),
          }),
        ]),
      );
      expect(
        result.value.validationWarnings.some(
          (issue) => issue.ruleId === 'connections-not-authorable',
        ),
      ).toBe(false);
    }
  });

  it('rejects a whole-workbook document whose dashboard references an omitted worksheet', async () => {
    const executor = { executeCommand: vi.fn() } as unknown as ToolExecutor;

    const result = await loadWorkbookXml({
      xml:
        "<?xml version='1.0'?><workbook>" +
        "<worksheets><worksheet name='Included Sheet'><table /></worksheet></worksheets>" +
        "<dashboards><dashboard name='Executive Dashboard'><zones>" +
        "<zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>" +
        "<zone h='98000' id='4' name='Missing Sheet' w='98000' x='1000' y='1000' />" +
        '</zone></zones></dashboard></dashboards>' +
        '</workbook>',
      executor,
      signal: new AbortController().signal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'dashboard-zones-reference-included-worksheets',
            severity: 'error',
            message: expect.stringContaining('Missing Sheet'),
          }),
        ]),
      );
    }
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });
});
