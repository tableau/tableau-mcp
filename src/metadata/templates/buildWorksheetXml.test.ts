import { existsSync, readFileSync } from 'fs';
import { dirname, resolve, sep } from 'path';

import { buildWorksheetXml } from './buildWorksheetXml.js';

const workbookXml = `<?xml version='1.0'?><workbook>
  <datasources><datasource name='target.ds'>
    <column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>
    <column name='[Segment]' datatype='string' role='dimension' type='nominal'/>
    <column name='[Profit]' datatype='real' role='measure' type='quantitative'/>
  </datasource></datasources>
  <worksheets><worksheet name='Existing'><table /></worksheet></worksheets>
  <windows><window class='worksheet' name='Existing' /></windows>
</workbook>`;

const templateXml =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  "<datasources><datasource name='donor.ds'>" +
  "<column name='[Donor Measure]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Donor Dimension]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource></datasources>' +
  '<table><rows>[donor.ds].[none:Donor Dimension:nk]</rows>' +
  '<cols>[donor.ds].[sum:Donor Measure:qk]</cols></table></bookmark>';

const plan = {
  templateName: 'offline-bar',
  title: 'Revenue by Segment',
  datasource: 'target.ds',
  fieldMapping: {
    field_base_1: '[target.ds].[none:Segment:nk]',
    field_base_2: '[target.ds].[sum:Revenue:qk]',
  },
};

describe('buildWorksheetXml', () => {
  it('binds supplied workbook and bookmark bytes without Desktop state', () => {
    const built = buildWorksheetXml({ workbookXml, templateXml, plan, nonce: 'preview-A' });

    expect(built.isOk()).toBe(true);
    if (built.isErr()) return;
    expect(built.value).toMatchObject({
      datasource: 'target.ds',
      bindings: [
        { slotId: 'field_base_1', field: '[target.ds].[none:Segment:nk]' },
        { slotId: 'field_base_2', field: '[target.ds].[sum:Revenue:qk]' },
      ],
      warnings: [],
    });
    expect(built.value.worksheetXml).toContain('Revenue');
    expect(built.value.worksheetXml).toContain('Segment');
    expect(built.value.worksheetXml).not.toMatch(/donor\.ds|Donor Measure|Donor Dimension|\{\{/);
    expect(built.value.windowXml).toContain('Revenue by Segment');
    expect(built.value.templateSourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(built.value).not.toHaveProperty('artifactId');
    expect(built.value).not.toHaveProperty('sessionId');
    expect(built.value).not.toHaveProperty('instanceId');
  });

  it('rejects an absent nonce and missing required binding with plain diagnostics', () => {
    const withoutNonce = buildWorksheetXml({ workbookXml, templateXml, plan, nonce: ' ' });
    expect(withoutNonce.isErr()).toBe(true);
    if (withoutNonce.isErr()) expect(withoutNonce.error).toMatchObject({ kind: 'args' });

    const missingBinding = buildWorksheetXml({
      workbookXml,
      templateXml,
      plan: { ...plan, fieldMapping: { field_base_1: plan.fieldMapping.field_base_1 } },
      nonce: 'preview-A',
    });
    expect(missingBinding.isErr()).toBe(true);
    if (missingBinding.isErr()) {
      expect(missingBinding.error).toMatchObject({ kind: 'args' });
      expect(missingBinding.error.message).toContain('field_base_2');
    }
  });

  it.each([
    { label: 'unclosed workbook', workbook: '<workbook><datasources>', template: templateXml },
    {
      label: 'mismatched workbook close',
      workbook: workbookXml.replace('</workbook>', '</different>'),
      template: templateXml,
    },
    {
      label: 'wrong workbook root',
      workbook: workbookXml.replace(/workbook/g, 'unrelated'),
      template: templateXml,
    },
    {
      label: 'wrong template root',
      workbook: workbookXml,
      template: '<unrelated><table /></unrelated>',
    },
    {
      label: 'mismatched template close',
      workbook: workbookXml,
      template: templateXml.replace('</bookmark>', '</different>'),
    },
    { label: 'missing template table', workbook: workbookXml, template: '<bookmark />' },
  ])('rejects $label before transforming supplied XML', ({ workbook, template }) => {
    const invalid = buildWorksheetXml({
      workbookXml: workbook,
      templateXml: template,
      plan,
      nonce: 'preview-A',
    });
    expect(invalid.isErr()).toBe(true);
    if (invalid.isErr()) expect(invalid.error.kind).toBe('xml');
  });

  it('uses the supplied nonce to isolate generated calculations', () => {
    const calcTemplate =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='donor.ds'>" +
      "<column name='[Margin]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Profit] / [Revenue]'/></column>" +
      "<column name='[Profit]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>" +
      '</datasource></datasources>' +
      '<table><view><datasources><datasource name="donor.ds"/></datasources>' +
      '<datasource-dependencies datasource="donor.ds">' +
      "<column name='[Profit]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Margin]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Profit] / [Revenue]'/></column>" +
      "<column-instance column='[Profit]' derivation='None' name='[none:Profit:nk]' pivot='key' type='quantitative'/>" +
      "<column-instance column='[Revenue]' derivation='None' name='[none:Revenue:nk]' pivot='key' type='quantitative'/>" +
      "<column-instance column='[Margin]' derivation='Sum' name='[sum:Margin:qk]' pivot='key' type='quantitative'/>" +
      '</datasource-dependencies></view>' +
      '<cols>[donor.ds].[sum:Margin:qk]</cols></table></bookmark>';
    const calcPlan = {
      ...plan,
      fieldMapping: {
        field_base_1: '[target.ds].[none:Profit:nk]',
        field_base_2: '[target.ds].[none:Revenue:nk]',
      },
    };

    const first = buildWorksheetXml({
      workbookXml,
      templateXml: calcTemplate,
      plan: calcPlan,
      nonce: 'A',
    });
    const second = buildWorksheetXml({
      workbookXml,
      templateXml: calcTemplate,
      plan: calcPlan,
      nonce: 'B',
    });
    expect(first.isOk(), first.isErr() ? JSON.stringify(first.error) : '').toBe(true);
    expect(second.isOk(), second.isErr() ? JSON.stringify(second.error) : '').toBe(true);
    if (first.isErr() || second.isErr()) return;
    expect(first.value.worksheetXml).not.toBe(second.value.worksheetXml);
  });

  it('keeps its transitive source imports outside Desktop and MCP layers', () => {
    const srcRoot = resolve(process.cwd(), 'src');
    const metadataRoot = resolve(srcRoot, 'metadata') + sep;
    const allowedUtility = resolve(srcRoot, 'utils/getExceptionMessage.ts');
    const pending = [resolve(srcRoot, 'metadata/templates/buildWorksheetXml.ts')];
    const visited = new Set<string>();
    const forbidden: string[] = [];

    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const source = readFileSync(file, 'utf8');
      const imports = source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g);
      for (const match of imports) {
        const dependency = resolve(dirname(file), match[1].replace(/\.js$/, '.ts'));
        if (!dependency.startsWith(metadataRoot) && dependency !== allowedUtility) {
          forbidden.push(`${file} -> ${dependency}`);
        } else if (existsSync(dependency)) {
          pending.push(dependency);
        }
      }
    }

    expect(forbidden).toEqual([]);
  });
});
