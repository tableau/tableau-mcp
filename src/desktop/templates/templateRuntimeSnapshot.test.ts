import { createTemplateRuntimeSnapshot } from './templateRuntimeSnapshot.js';

const BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.secret' caption='Donor Datasource Secret'>" +
  "<column name='[Donor Measure Secret]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Donor Dimension Secret]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.secret].[none:Donor Dimension Secret:nk]</rows>' +
  '<cols>[federated.secret].[sum:Donor Measure Secret:qk]</cols>' +
  '</table>' +
  '</bookmark>';

const PARAMETER_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<table>' +
  '<view>' +
  '<datasources>' +
  "<datasource name='federated.secret'/>" +
  "<datasource name='Parameters'/>" +
  '</datasources>' +
  "<datasource-dependencies datasource='Parameters'>" +
  "<column name='[Parameter 3]' datatype='real' param-domain-type='any' role='measure' type='quantitative' value='0.8'>" +
  "<calculation class='tableau' formula='0.8'/>" +
  '</column>' +
  '</datasource-dependencies>' +
  "<datasource-dependencies datasource='federated.secret'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative'/>" +
  '</datasource-dependencies>' +
  '</view>' +
  '<rows>[federated.secret].[sum:Sales:qk]</rows>' +
  "<reference-line axis-column='[federated.secret].[sum:Sales:qk]' value-column='[Parameters].[Parameter 3]'/>" +
  '</table>' +
  '</bookmark>';

describe('createTemplateRuntimeSnapshot', () => {
  it('derives one neutral binding descriptor and injectable workbook from TBM bytes', () => {
    const snapshot = createTemplateRuntimeSnapshot('safe-bar', BOOKMARK);

    expect(snapshot.template).toBe('safe-bar');
    expect(snapshot.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.eligibility).toEqual({ pass1_eligible: true, pass1_blockers: [] });
    expect(snapshot.descriptor).toEqual({
      template: 'safe-bar',
      slots: [
        expect.objectContaining({
          slot_id: 'field_base_1',
          template_field: '{{field_base_1}}',
          kind: 'categorical',
          derivation: 'none',
          required: true,
        }),
        expect.objectContaining({
          slot_id: 'field_base_2',
          template_field: '{{field_base_2}}',
          kind: 'quantitative',
          derivation: 'sum',
          required: true,
        }),
      ],
      calcs: [],
    });
    expect(snapshot.xml).toContain('{{TITLE}}');
    expect(snapshot.xml).toContain('{{DATASOURCE}}');
    expect(snapshot.xml).toContain('{{field_base_1}}');
    expect(snapshot.xml).toContain('{{field_base_2}}');

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(
      /Donor Measure Secret|Donor Dimension Secret|Donor Datasource Secret/,
    );
    expect(snapshot.descriptor).not.toHaveProperty('family');
    expect(snapshot.descriptor).not.toHaveProperty('readiness');
    expect(snapshot.descriptor).not.toHaveProperty('fast_path_eligible');
    expect(snapshot.descriptor).not.toHaveProperty('intent_keywords');
  });

  it('hashes the original TBM source, not the derived XML', () => {
    const first = createTemplateRuntimeSnapshot('safe-bar', BOOKMARK);
    const second = createTemplateRuntimeSnapshot(
      'safe-bar',
      BOOKMARK.replace('</bookmark>', '<!--source-change--></bookmark>'),
    );

    expect(first.xml).toBe(second.xml);
    expect(first.sourceHash).not.toBe(second.sourceHash);
  });

  it('keeps the Tableau Parameters datasource separate from the bound datasource', () => {
    const snapshot = createTemplateRuntimeSnapshot('parameter-chart', PARAMETER_BOOKMARK);

    expect(snapshot.xml).toContain("datasource='Parameters'");
    expect(snapshot.xml).toContain('[Parameters].[Parameter 3]');
    expect(snapshot.xml).not.toContain('[{{DATASOURCE}}].[Parameter 3]');
    expect(snapshot.xml).not.toContain('federated.secret');
  });
});
