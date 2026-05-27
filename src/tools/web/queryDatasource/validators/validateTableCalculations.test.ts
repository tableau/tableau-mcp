import { Field } from '../../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { ToolRules } from '../../tool.js';
import { validateTableCalculations } from './validateTableCalculations.js';

const enabled: ToolRules = { enableTableCalculations: true };
const disabled: ToolRules = { enableTableCalculations: false };

describe('validateTableCalculations', () => {
  it('should not throw when no fields use table calculations', () => {
    const fields: Field[] = [{ fieldCaption: 'Sales', function: 'SUM' }];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
    expect(() => validateTableCalculations(fields, disabled)).not.toThrow();
  });

  it('should throw a version-gate error when table calcs are used and the rule is disabled', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: { tableCalcType: 'RANK', dimensions: [] },
      },
    ];
    expect(() => validateTableCalculations(fields, disabled)).toThrow(
      'Table calculations require Tableau v2025.3 or newer. The connected Tableau server does not support tableCalculation fields.',
    );
  });

  it('should throw the version-gate error for nestedTableCalculations on older servers', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Outer',
        calculation: '[Inner]',
        nestedTableCalculations: [
          { tableCalcType: 'NESTED', fieldCaption: 'Inner', dimensions: [] },
        ],
      },
    ];
    expect(() => validateTableCalculations(fields, disabled)).toThrow(
      'Table calculations require Tableau v2025.3 or newer.',
    );
  });

  it('should accept a RANK table calculation when enabled', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: {
          tableCalcType: 'RANK',
          dimensions: [{ fieldCaption: 'Region' }],
          rankType: 'COMPETITION',
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
  });

  it('should reject a NESTED specification placed in tableCalculation', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: {
          tableCalcType: 'NESTED',
          fieldCaption: 'Inner',
          dimensions: [],
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).toThrow(
      "Field 'Profit' uses a NESTED table calculation in the 'tableCalculation' property",
    );
  });

  it('should reject a CUSTOM table calculation that is missing a calculation expression', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'MyCustom',
        tableCalculation: {
          tableCalcType: 'CUSTOM',
          dimensions: [{ fieldCaption: 'Region' }],
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).toThrow(
      "Field 'MyCustom' uses a CUSTOM table calculation but does not provide a 'calculation' expression",
    );
  });

  it('should accept a CUSTOM table calculation when calculation is supplied', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'MyCustom',
        calculation: 'WINDOW_SUM(SUM([Sales]))',
        tableCalculation: {
          tableCalcType: 'CUSTOM',
          dimensions: [{ fieldCaption: 'Region' }],
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
  });

  it('should reject MOVING_CALCULATION with an empty window', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: {
          tableCalcType: 'MOVING_CALCULATION',
          dimensions: [],
          previous: 0,
          next: 0,
          includeCurrent: false,
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).toThrow(
      "Field 'Profit' has a MOVING_CALCULATION with an empty window",
    );
  });

  it('should accept MOVING_CALCULATION using its defaults', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: {
          tableCalcType: 'MOVING_CALCULATION',
          dimensions: [{ fieldCaption: 'Region' }],
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
  });

  it('should reject non-NESTED specifications inside nestedTableCalculations', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Outer',
        calculation: '[Inner]',
        tableCalculation: { tableCalcType: 'CUSTOM', dimensions: [] },
        nestedTableCalculations: [
          { tableCalcType: 'RANK', dimensions: [], rankType: 'COMPETITION' },
        ],
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).toThrow(
      "Field 'Outer' has a non-NESTED specification (tableCalcType 'RANK') in 'nestedTableCalculations'",
    );
  });

  it('should reject duplicate fieldCaptions in nestedTableCalculations', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Outer',
        calculation: '[Inner1] + [Inner2]',
        tableCalculation: { tableCalcType: 'CUSTOM', dimensions: [] },
        nestedTableCalculations: [
          { tableCalcType: 'NESTED', fieldCaption: 'Inner', dimensions: [] },
          { tableCalcType: 'NESTED', fieldCaption: 'Inner', dimensions: [] },
        ],
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).toThrow(
      "Field 'Outer' has duplicate nested table calculation fieldCaption 'Inner'",
    );
  });

  it('should accept a valid nested table calculation arrangement', () => {
    const fields: Field[] = [
      {
        fieldCaption: '3-nest',
        calculation: '[1-nest] + [2-nest]',
        tableCalculation: { tableCalcType: 'CUSTOM', dimensions: [] },
        nestedTableCalculations: [
          {
            tableCalcType: 'NESTED',
            fieldCaption: '1-nest',
            dimensions: [
              { fieldCaption: 'Region' },
              { fieldCaption: 'Segment' },
              { fieldCaption: 'Order Date', function: 'YEAR' },
            ],
          },
          {
            tableCalcType: 'NESTED',
            fieldCaption: '2-nest',
            dimensions: [{ fieldCaption: 'Region' }, { fieldCaption: 'Segment' }],
            restartEvery: { fieldCaption: 'Region' },
          },
        ],
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
  });

  it('should accept a RUNNING_TOTAL with a secondary calculation', () => {
    const fields: Field[] = [
      {
        fieldCaption: 'Profit',
        function: 'SUM',
        tableCalculation: {
          tableCalcType: 'RUNNING_TOTAL',
          dimensions: [{ fieldCaption: 'Region' }],
          aggregation: 'SUM',
          secondaryTableCalculation: {
            tableCalcType: 'PERCENT_DIFFERENCE_FROM',
            dimensions: [{ fieldCaption: 'Region' }],
            relativeTo: 'PREVIOUS',
          },
        },
      },
    ];
    expect(() => validateTableCalculations(fields, enabled)).not.toThrow();
  });
});
