// src/binder/calc-derivation.test.ts
//
// Pure derivation of first-class CALC SLOTS from template XML (H3 flagship). These
// helpers are the single TS source of truth for turning a template's <calculation>
// formulas into declared, classified inputs. The generator
// (scripts/build-template-manifests.js) mirrors this logic in JS; the contract test
// asserts the two agree with the committed manifests (drift catch).

import { describe, expect, it } from 'vitest';

import {
  deriveCalcInputs,
  deriveDependsOnSlots,
  detectCoercion,
  extractFormulaRefs,
  parseTemplateCalcs,
} from './calc-derivation.js';
import type { SlotSpec } from './manifest-types.js';

const WW_FORMULA = 'INT([Actual Input]) - [Reference Value]';
const SCATTER_FORMULA = 'SUM([Profit])/SUM([Sales])';

// Slots as declared in the two committed calc manifests.
const WW_SLOTS: SlotSpec[] = [
  {
    slot_id: 'row_dimension',
    template_field: 'Category',
    derivation: 'none',
    role: ['rows'],
    kind: 'categorical',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'line_measure',
    template_field: 'Reference Value',
    derivation: 'min',
    role: ['cols'],
    kind: 'quantitative',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'actual_input',
    template_field: 'Actual Input',
    derivation: 'none',
    role: ['formula-input'],
    kind: 'categorical',
    bindable: true,
    required: true,
  },
  {
    slot_id: 'color_dimension',
    template_field: 'Segment',
    derivation: 'none',
    role: ['color'],
    kind: 'categorical',
    bindable: true,
    required: true,
  },
];

const SCATTER_SLOTS: SlotSpec[] = [
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
];

describe('calc-derivation — parseTemplateCalcs', () => {
  it('extracts each calc <column> (template_field, formula, result_role) from template XML', () => {
    const xml = `<workbook><datasource-dependencies>
      <column caption='Gantt Size' datatype='real' name='[Calculation_GanttSize]' role='measure' type='quantitative'>
        <calculation class='tableau' formula='INT([Actual Input]) - [Reference Value]' />
      </column>
      <column datatype='string' name='[Actual Input]' role='dimension' type='nominal' />
    </datasource-dependencies></workbook>`;
    const calcs = parseTemplateCalcs(xml);
    expect(calcs).toEqual([
      { template_field: 'Calculation_GanttSize', formula: WW_FORMULA, result_role: 'measure' },
    ]);
  });

  it('returns [] when the XML has no <calculation>', () => {
    const xml = `<workbook><datasource-dependencies>
      <column datatype='string' name='[Region]' role='dimension' type='nominal' />
    </datasource-dependencies></workbook>`;
    expect(parseTemplateCalcs(xml)).toEqual([]);
  });

  it('dedupes a calc column declared twice (datasources + datasource-dependencies)', () => {
    const col =
      "<column datatype='real' name='[C]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([Profit])' /></column>";
    const xml = `<workbook><datasources>${col}</datasources><datasource-dependencies>${col}</datasource-dependencies></workbook>`;
    const calcs = parseTemplateCalcs(xml);
    expect(calcs.length).toBe(1);
    expect(calcs[0].template_field).toBe('C');
  });

  it('decodes XML entities in the formula', () => {
    const xml =
      "<workbook><column name='[C]' role='dimension'><calculation formula='IF [A] &gt; 0 THEN &quot;hi&quot; END' /></column></workbook>";
    const calcs = parseTemplateCalcs(xml);
    expect(calcs[0].formula).toBe('IF [A] > 0 THEN "hi" END');
    expect(calcs[0].result_role).toBe('dimension');
  });
});

describe('calc-derivation — extractFormulaRefs', () => {
  it('returns bare [Field] tokens in first-appearance order, de-duplicated', () => {
    expect(extractFormulaRefs(WW_FORMULA)).toEqual(['Actual Input', 'Reference Value']);
    expect(extractFormulaRefs(SCATTER_FORMULA)).toEqual(['Profit', 'Sales']);
    expect(extractFormulaRefs('[A] + [B] + [A]')).toEqual(['A', 'B']);
  });

  it('returns [] for a formula with no field refs', () => {
    expect(extractFormulaRefs('1 + 2')).toEqual([]);
  });
});

describe('calc-derivation — detectCoercion', () => {
  it('flags a parse/coercion function wrapping the ref (INT)', () => {
    expect(detectCoercion(WW_FORMULA, 'Actual Input')).toBe('INT');
  });

  it('does NOT flag an aggregation wrapper (SUM) as a coercion advisory', () => {
    expect(detectCoercion(SCATTER_FORMULA, 'Profit')).toBeUndefined();
  });

  it('returns undefined for a bare (unwrapped) ref', () => {
    expect(detectCoercion(WW_FORMULA, 'Reference Value')).toBeUndefined();
  });
});

describe('calc-derivation — deriveCalcInputs', () => {
  it('classifies ww-floating-bars inputs: both reference declared bindable slots; INT() coercion on the string input', () => {
    const inputs = deriveCalcInputs(WW_FORMULA, WW_SLOTS, true);
    expect(inputs).toEqual([
      {
        ref: 'Actual Input',
        slot_id: 'actual_input',
        slot_kind: 'categorical',
        required: true,
        template_internal: false,
        coercion: 'INT',
      },
      {
        ref: 'Reference Value',
        slot_id: 'line_measure',
        slot_kind: 'quantitative',
        required: true,
        template_internal: false,
      },
    ]);
  });

  it('classifies correlation-scatter inputs: both quantitative slot refs, no coercion', () => {
    const inputs = deriveCalcInputs(SCATTER_FORMULA, SCATTER_SLOTS, true);
    expect(inputs).toEqual([
      {
        ref: 'Profit',
        slot_id: 'profit',
        slot_kind: 'quantitative',
        required: true,
        template_internal: false,
      },
      {
        ref: 'Sales',
        slot_id: 'sales',
        slot_kind: 'quantitative',
        required: true,
        template_internal: false,
      },
    ]);
  });

  it('marks a ref with no matching declared slot as template_internal (slot_kind calc)', () => {
    const inputs = deriveCalcInputs('[Profit] + [MysteryInternal]', SCATTER_SLOTS, true);
    const internal = inputs.find((i) => i.ref === 'MysteryInternal')!;
    expect(internal.template_internal).toBe(true);
    expect(internal.slot_id).toBeNull();
    expect(internal.slot_kind).toBe('calc');
  });

  it("input.required follows the calc's required flag", () => {
    const inputs = deriveCalcInputs(SCATTER_FORMULA, SCATTER_SLOTS, false);
    expect(inputs.every((i) => i.required === false)).toBe(true);
  });
});

describe('calc-derivation — deriveDependsOnSlots', () => {
  it('is the bindable slot_ids referenced by the formula, in appearance order', () => {
    expect(deriveDependsOnSlots(WW_FORMULA, WW_SLOTS)).toEqual(['actual_input', 'line_measure']);
    expect(deriveDependsOnSlots(SCATTER_FORMULA, SCATTER_SLOTS)).toEqual(['profit', 'sales']);
  });

  it('excludes template-internal refs and non-bindable slot refs', () => {
    const slots: SlotSpec[] = [
      {
        slot_id: 'm',
        template_field: 'M',
        derivation: 'sum',
        role: ['cols'],
        kind: 'quantitative',
        bindable: true,
        required: true,
      },
      {
        slot_id: 'gen',
        template_field: 'Latitude (generated)',
        derivation: 'none',
        role: ['cols'],
        kind: 'generated',
        bindable: false,
        required: true,
      },
    ];
    expect(deriveDependsOnSlots('[M] + [Latitude (generated)] + [Nope]', slots)).toEqual(['m']);
  });
});
