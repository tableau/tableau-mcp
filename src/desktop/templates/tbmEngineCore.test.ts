import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { bindExplicitTemplate, schemaSummaryFromAvailableFields } from '../binder/explicit-bind.js';
import { bookmarkToTemplateWorkbook, deriveTemplatePass1Eligibility } from './bookmarkTemplate.js';
import { inferBindingDescriptor, inferFromBookmark } from './inferSlots.js';
import { buildInjectedWorkbookXml } from './injectTemplateCore.js';

const PULSE_SHAPED_BOOKMARK =
  "\r\n<?xml version='1.0'?><bookmark version='10.1'>" +
  "<datasources><datasource name='donor.ds' caption='Donor'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Region]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource></datasources>' +
  '<table><rows>[donor.ds].[none:Region:nk]</rows>' +
  '<cols>[donor.ds].[sum:Sales:qk]</cols></table>' +
  "<window class='worksheet' name='LineChart'><highlight>" +
  '<field>[donor.ds].[attr:AGG(Pulse Highlight):nk]</field>' +
  '</highlight></window></bookmark>';

describe('clean TBM engine', () => {
  it('derives a donor-free template and drops transient Pulse highlight state', () => {
    const inference = inferFromBookmark(PULSE_SHAPED_BOOKMARK);
    const converted = bookmarkToTemplateWorkbook(PULSE_SHAPED_BOOKMARK, inference);

    expect(inference.slots.map((slot) => slot.sourceField)).toEqual(['Region', 'Sales']);
    expect(converted.xml.startsWith('<?xml')).toBe(true);
    expect(converted.xml).not.toContain('donor.ds');
    expect(converted.xml).not.toContain('Donor');
    expect(converted.xml).not.toContain('<highlight>');
    expect(converted.xml).not.toContain('Pulse Highlight');
    expect(deriveTemplatePass1Eligibility(converted)).toEqual({
      pass1_eligible: true,
      pass1_blockers: [],
    });
  });

  it('injects a converted bookmark against a different datasource with no placeholder residue', () => {
    const inference = inferFromBookmark(PULSE_SHAPED_BOOKMARK);
    const converted = bookmarkToTemplateWorkbook(PULSE_SHAPED_BOOKMARK, inference);
    const fieldMapping = Object.fromEntries(
      inference.slots.map((slot) => [
        slot.templateField,
        slot.sourceField === 'Sales'
          ? '[target.ds].[sum:Revenue:qk]'
          : '[target.ds].[none:Segment:nk]',
      ]),
    );

    const result = buildInjectedWorkbookXml({
      workbookXml: "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>",
      templateXml: converted.xml,
      title: 'Target view',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'target.ds' },
      fieldMapping,
      templateSlots: inference.slots.map((slot) => ({
        slot_id: slot.slot_id,
        template_field: slot.templateField,
        required: slot.required,
        bindable: true,
        kind: slot.kind,
      })),
      applyNonce: 'cross-datasource-test',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('target.ds');
    expect(result.xml).toContain('Revenue');
    expect(result.xml).toContain('Segment');
    expect(result.xml).not.toContain('donor.ds');
    expect(result.xml).not.toMatch(/\{\{(?:DATASOURCE|field_base_\d+)\}\}/);
  });

  it('binds inferred canonical ctd and med slots without changing their authored derivations', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='donor.ds'>" +
      "<column name='[Customers]' datatype='integer' role='measure' type='quantitative'/>" +
      "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
      '</datasource></datasources><table>' +
      '<rows>[donor.ds].[ctd:Customers:qk]</rows>' +
      '<cols>[donor.ds].[med:Sales:qk]</cols>' +
      '</table></bookmark>';
    const descriptor = inferBindingDescriptor('canonical-bind', inferFromBookmark(raw));
    const schema = schemaSummaryFromAvailableFields([
      {
        datasource: 'target.ds',
        columnName: '[Accounts]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'integer',
        column_ref: '[target.ds].[sum:Accounts:qk]',
      },
      {
        datasource: 'target.ds',
        columnName: '[Revenue]',
        role: 'measure',
        type: 'quantitative',
        datatype: 'real',
        column_ref: '[target.ds].[sum:Revenue:qk]',
      },
    ]);

    const result = bindExplicitTemplate(
      descriptor.template,
      {
        field_base_1: '[target.ds].[sum:Accounts:qk]',
        field_base_2: '[target.ds].[sum:Revenue:qk]',
      },
      schema,
      { contract: descriptor, datasource: 'target.ds' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fieldMapping).toEqual({
      '{{field_base_1}}': '[target.ds].[ctd:Accounts:qk]',
      '{{field_base_2}}': '[target.ds].[med:Revenue:qk]',
    });
  });

  it('binds one logical CountD field while preserving each ranking reference role', () => {
    const raw = readFileSync(
      join(
        process.cwd(),
        'src',
        'desktop',
        'data',
        'templates',
        'ranking__ordered-bar__show-order-when-rank-matters-more-than-value.tbm',
      ),
      'utf8',
    );
    const inference = inferFromBookmark(raw);
    const descriptor = inferBindingDescriptor('ranking-role-regression', inference);
    const converted = bookmarkToTemplateWorkbook(raw, inference);
    const orderIdSlot = inference.slots.find(
      (slot) => slot.sourceField === 'Order ID' && slot.derivation === 'ctd',
    );
    expect(orderIdSlot).toBeDefined();
    expect(orderIdSlot?.instanceRole).toBeUndefined();
    expect(
      descriptor.slots.filter(
        (slot) => slot.template_field === orderIdSlot?.templateField && slot.derivation === 'ctd',
      ),
    ).toHaveLength(1);

    const schema = schemaSummaryFromAvailableFields([
      {
        datasource: 'target.ds',
        columnName: '[Segment]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[target.ds].[none:Segment:nk]',
      },
      {
        datasource: 'target.ds',
        columnName: '[Customer ID]',
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        column_ref: '[target.ds].[none:Customer ID:nk]',
      },
    ]);
    const input = Object.fromEntries(
      descriptor.slots.map((slot, index) => [
        slot.slot_id,
        inference.slots[index]?.sourceField === 'Order ID'
          ? '[target.ds].[none:Customer ID:nk]'
          : '[target.ds].[none:Segment:nk]',
      ]),
    );
    const binding = bindExplicitTemplate(descriptor.template, input, schema, {
      contract: descriptor,
      datasource: 'target.ds',
    });
    expect(binding.ok).toBe(true);
    if (!binding.ok) return;

    const result = buildInjectedWorkbookXml({
      workbookXml: "<?xml version='1.0'?><workbook><worksheets/><windows/></workbook>",
      templateXml: converted.xml,
      title: 'Ranking',
      sheetType: 'worksheet',
      templateParameters: { DATASOURCE: 'target.ds' },
      fieldMapping: binding.fieldMapping,
      fieldMetadata: binding.fieldMetadata,
      templateSlots: binding.templateSlots,
      applyNonce: 'ranking-role-regression',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.xml).toContain('[target.ds].[rank:ctd:Customer ID:ok]');
    expect(result.xml).toContain('[target.ds].[ctd:Customer ID:qk]');
  });
});
