import { isTableCalcField, validateFields } from './validateFields.js';

describe('validateFields', () => {
  it('should not throw for a valid single field', () => {
    expect(() => validateFields([{ fieldCaption: 'Sales' }], {})).not.toThrow();
  });

  it('should throw if fields array is empty', () => {
    expect(() => validateFields([], {})).toThrow(
      'The query must include at least one field. The fields property cannot be an empty array.',
    );
  });

  it('should throw if field does not have a fieldCaption', () => {
    // @ts-expect-error - This is a test for the type validator
    expect(() => validateFields([{ calculation: 'SUM([Sales])' }], {})).toThrow(
      'The query must not include any fields with an empty fieldCaption.',
    );
  });

  it('should throw if any field has an empty fieldCaption', () => {
    expect(() => validateFields([{ fieldCaption: '' }], {})).toThrow(
      'The query must not include any fields with an empty fieldCaption.',
    );
  });

  it('should throw if there are duplicate sort priorities', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Sales', sortPriority: 1 },
          { fieldCaption: 'Profit', sortPriority: 1 },
          { fieldCaption: 'Region', sortPriority: -1 },
          { fieldCaption: 'Component', sortPriority: -1 },
        ],
        {},
      ),
    ).toThrow(
      'The query must not include duplicate sort priorities. The following fields have sort priorities that are duplicated: "Sales", "Profit" with a sort priority of 1. "Region", "Component" with a sort priority of -1.',
    );
  });

  it('should not throw if sort priorities are unique or undefined', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Sales', sortPriority: 1 },
          { fieldCaption: 'Profit', sortPriority: 2 },
          { fieldCaption: 'Region' },
        ],
        {},
      ),
    ).not.toThrow();
  });

  it('should throw if a field has both function and calculation', () => {
    expect(() =>
      validateFields([{ fieldCaption: 'Sales', function: 'SUM', calculation: 'AVG([Sales])' }], {}),
    ).toThrow(
      'The query must not include fields that contain both a function and a calculation. The following fields contain both a function and a calculation: Sales.',
    );
  });

  it('should not throw if a field has only function or only calculation', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Sales', function: 'SUM' },
          { fieldCaption: 'Profit', calculation: 'SUM([Profit])' },
        ],
        {},
      ),
    ).not.toThrow();
  });

  it('should throw if a field has negative maxDecimalPlaces', () => {
    expect(() => validateFields([{ fieldCaption: 'Sales', maxDecimalPlaces: -1 }], {})).toThrow(
      'The query must not include fields that have a maxDecimalPlaces value that is less than 0. The following fields have a maxDecimalPlaces value that is less than 0: Sales.',
    );
  });

  it('should not throw if maxDecimalPlaces is 0 or positive', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Sales', maxDecimalPlaces: 0 },
          { fieldCaption: 'Profit', maxDecimalPlaces: 2 },
        ],
        {},
      ),
    ).not.toThrow();
  });
});

describe('isTableCalcField', () => {
  it('identifies a table calc field even when it also has function and calculation', () => {
    expect(
      isTableCalcField({
        fieldCaption: 'X',
        function: 'SUM',
        calculation: 'SUM([Sales])',
        tableCalculation: { tableCalcType: 'RANK', dimensions: [] },
      }),
    ).toBe(true);
  });

  it.each([
    { fieldCaption: 'Category' },
    { fieldCaption: 'Sales', function: 'SUM' as const },
    { fieldCaption: 'X', calculation: 'SUM([Sales])' },
    { fieldCaption: 'Sales', binSize: 10 },
  ])('returns false for %j', (field) => {
    expect(isTableCalcField(field)).toBe(false);
  });
});

describe('validateFields with restrictTableCalculations', () => {
  const rules = { restrictTableCalculations: true };
  const rank = {
    fieldCaption: 'Sales',
    function: 'SUM' as const,
    tableCalculation: {
      tableCalcType: 'RANK' as const,
      dimensions: [{ fieldCaption: 'Category' }],
    },
  };

  it('rejects table calc fields, names them, and names the minimum version', () => {
    expect(() => validateFields([{ fieldCaption: 'Category' }, rank], rules)).toThrow(
      'The query must not include table calculation fields. Table calculations require Tableau 2025.3 or later. The following fields are table calculations: Sales.',
    );
  });

  it('allows other field types', () => {
    expect(() =>
      validateFields(
        [{ fieldCaption: 'Category' }, { fieldCaption: 'Sales', function: 'SUM' }],
        rules,
      ),
    ).not.toThrow();
  });

  it('allows table calc fields without the rule', () => {
    expect(() => validateFields([{ fieldCaption: 'Category' }, rank], {})).not.toThrow();
  });
});

describe('validateFields with table calc fields', () => {
  const dimensions = [{ fieldCaption: 'Category' }];

  it('rejects a table calc with a calculation and a quick tableCalcType', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Category' },
          {
            fieldCaption: 'Margin Rank',
            calculation: 'SUM([Profit]) / SUM([Sales])',
            tableCalculation: { tableCalcType: 'RANK', dimensions },
          },
        ],
        {},
      ),
    ).toThrow(
      'The query must not include table calculation fields that have a calculation and a tableCalcType other than CUSTOM. With a calculation, use tableCalcType CUSTOM and write the table calculation function in the calculation, for example RANK(SUM([Sales])). The following fields are invalid: Margin Rank.',
    );
  });

  it('allows a CUSTOM table calc with a calculation', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Category' },
          {
            fieldCaption: 'Sales Rank',
            calculation: 'RANK(SUM([Sales]))',
            tableCalculation: { tableCalcType: 'CUSTOM', dimensions },
          },
        ],
        {},
      ),
    ).not.toThrow();
  });

  it('allows a quick table calc on a fieldCaption and function', () => {
    expect(() =>
      validateFields(
        [
          { fieldCaption: 'Category' },
          {
            fieldCaption: 'Sales',
            function: 'SUM',
            tableCalculation: { tableCalcType: 'RANK', dimensions },
          },
        ],
        {},
      ),
    ).not.toThrow();
  });

  it('rejects a table calc with both a function and a calculation', () => {
    expect(() =>
      validateFields(
        [
          {
            fieldCaption: 'Sales Rank',
            function: 'SUM',
            calculation: 'RANK(SUM([Sales]))',
            tableCalculation: { tableCalcType: 'CUSTOM', dimensions },
          },
        ],
        {},
      ),
    ).toThrow(
      'The query must not include fields that contain both a function and a calculation. The following fields contain both a function and a calculation: Sales Rank.',
    );
  });
});
