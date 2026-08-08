import { Ok } from 'ts-results-es';

import invariant from '../../utils/invariant.js';
import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { buildInjectedWorkbookXml } from '../templates/injectTemplateCore.js';
import { readTemplate } from '../templates/templatePath.js';
import { loadWorkbookXml } from './loadWorkbookXml.js';

// Focus is a required argument at every write seam. Suites that are not about
// navigation pass the disposition that dispatches nothing.
const NO_FOCUS = { navigate: 'none', reason: 'intermediate-leg' } as const;
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
    const executor = makeExecutorMock({ applyWorkbookDocument });

    const result = await loadWorkbookXml({
      xml,
      executor,
      signal: new AbortController().signal,
      focus: NO_FOCUS,
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
    const templateXml = readTemplate('ranking-ordered-bar')!;
    const injected = buildInjectedWorkbookXml({
      workbookXml,
      templateXml,
      title: 'World Cup Countries by Goal Difference',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: datasource },
      fieldMapping: {
        '{{field_base_1}}': `[${datasource}].[none:country:nk]`,
        '{{field_base_2}}': `[${datasource}].[sum:goalDifference:qk]`,
      },
      templateSlots: [
        {
          template_field: '{{field_base_1}}',
          required: true,
          bindable: true,
          kind: 'categorical',
          role: ['rows', 'sort-dimension'],
        },
        {
          template_field: '{{field_base_2}}',
          required: true,
          bindable: true,
          kind: 'quantitative',
          role: ['cols', 'sort-measure'],
        },
        {
          template_field: '{{field_base_3}}',
          required: false,
          bindable: true,
          kind: 'categorical',
          role: ['rows'],
        },
      ],
      applyNonce: 'miller-world-cup',
    });
    expect(injected.ok).toBe(true);
    invariant(injected.ok);
    // The bind must consume every explicit placeholder rather than passing a
    // donor-specific template through preflight unchanged.
    expect(injected.xml).toContain('[none:country:nk]');
    expect(injected.xml).toContain('[sum:goalDifference:qk]');
    expect(injected.xml).not.toMatch(/\{\{field_base_\d+\}\}/);

    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({ applyWorkbookDocument });
    const result = await loadWorkbookXml({
      xml: injected.xml,
      executor,
      signal: new AbortController().signal,
      focus: NO_FOCUS,
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
    const executor = makeExecutorMock({ executeCommand: vi.fn() });

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
      focus: NO_FOCUS,
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

  it('allows a candidate that preserves an unrelated blocking issue from the baseline', async () => {
    const brokenDashboard =
      "<worksheets><worksheet name='Included Sheet'><table /></worksheet></worksheets>" +
      "<dashboards><dashboard name='Existing Broken Dashboard'><zones>" +
      "<zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>" +
      "<zone h='98000' id='4' name='Missing Sheet' w='98000' x='1000' y='1000' />" +
      '</zone></zones></dashboard></dashboards>';
    const baselineXml = `<?xml version='1.0'?><workbook>${brokenDashboard}</workbook>`;
    const candidateXml = `<?xml version='1.0'?><workbook>${brokenDashboard}<windows /></workbook>`;
    const applyWorkbookDocument = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'cmd', status: 'completed', submitted_at: '' }));
    const executor = makeExecutorMock({ applyWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: candidateXml,
      baselineXml,
      executor,
      signal: new AbortController().signal,
      focus: NO_FOCUS,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
  });

  it('rejects a blocking issue introduced relative to the baseline', async () => {
    const baselineXml =
      "<?xml version='1.0'?><workbook>" +
      "<worksheets><worksheet name='Included Sheet'><table /></worksheet></worksheets>" +
      '</workbook>';
    const candidateXml =
      "<?xml version='1.0'?><workbook>" +
      "<worksheets><worksheet name='Included Sheet'><table /></worksheet></worksheets>" +
      "<dashboards><dashboard name='New Broken Dashboard'><zones>" +
      "<zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>" +
      "<zone h='98000' id='4' name='Missing Sheet' w='98000' x='1000' y='1000' />" +
      '</zone></zones></dashboard></dashboards></workbook>';
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({ applyWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: candidateXml,
      baselineXml,
      executor,
      signal: new AbortController().signal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual([
        expect.objectContaining({
          ruleId: 'dashboard-zones-reference-included-worksheets',
          message: expect.stringContaining('Missing Sheet'),
        }),
      ]);
    }
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('rejects an increased occurrence count for a baseline blocking issue', async () => {
    const datasourceStart = "<?xml version='1.0'?><workbook><datasources><datasource name='Data'>";
    const firstReference =
      "<column name='[C1]'><calculation class='tableau' formula='IF [Missing Set] THEN 1 ELSE 0 END'/></column>";
    const secondReference =
      "<column name='[C2]'><calculation class='tableau' formula='IF [Missing Set] THEN 2 ELSE 0 END'/></column>";
    const datasourceEnd = '</datasource></datasources></workbook>';
    const baselineXml = datasourceStart + firstReference + datasourceEnd;
    const candidateXml = datasourceStart + firstReference + secondReference + datasourceEnd;
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({ applyWorkbookDocument });

    const result = await loadWorkbookXml({
      xml: candidateXml,
      baselineXml,
      executor,
      signal: new AbortController().signal,
      focus: NO_FOCUS,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'load-workbook-xml-error');
      invariant(result.error.error.type === 'validation-failed');
      expect(result.error.error.issues).toEqual([
        expect.objectContaining({
          ruleId: 'undeclared-set-reference',
          occurrenceCount: 2,
        }),
      ]);
    }
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });
});
