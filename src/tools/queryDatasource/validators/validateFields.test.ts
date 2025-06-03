import { validateFields } from './validateFields.js';

describe('validateFields', () => {
  it('should not throw for a valid single field', () => {
    expect(() => validateFields([{ fieldCaption: 'Sales' }])).not.toThrow();
  });

  it('should throw if fields array is empty', () => {
    expect(() => validateFields([])).toThrow(
      'The query must include at least one field. The fields property cannot be an empty array.',
    );
  });

  it('should throw if field does not have a fieldCaption', () => {
    // @ts-expect-error - This is a test for the type validator
    expect(() => validateFields([{ calculation: 'SUM([Sales])' }])).toThrow(
      'The query must not include any fields with an empty fieldCaption.',
    );
  });

  it('should throw if any field has an empty fieldCaption', () => {
    expect(() => validateFields([{ fieldCaption: '' }])).toThrow(
      'The query must not include any fields with an empty fieldCaption.',
    );
  });

  it('should throw if there are duplicate fieldCaptions', () => {
    expect(() =>
      validateFields([
        { fieldCaption: 'Sales' },
        { fieldCaption: 'Sales' },
        { fieldCaption: 'Region' },
        { fieldCaption: 'Profit' },
        { fieldCaption: 'Region' },
      ]),
    ).toThrow(
      'The query must not include duplicate fields. The following fields are duplicated: Sales, Region.',
    );
  });

  it('should throw if there are duplicate sort priorities', () => {
    expect(() =>
      validateFields([
        { fieldCaption: 'Sales', sortPriority: 1 },
        { fieldCaption: 'Profit', sortPriority: 1 },
        { fieldCaption: 'Region', sortPriority: -1 },
        { fieldCaption: 'Component', sortPriority: -1 },
      ]),
    ).toThrow(
      'The query must not include duplicate sort priorities. The following fields have sort priorities that are duplicated: "Sales", "Profit" with a sort priority of 1. "Region", "Component" with a sort priority of -1.',
    );
  });

  it('should not throw if sort priorities are unique or undefined', () => {
    expect(() =>
      validateFields([
        { fieldCaption: 'Sales', sortPriority: 1 },
        { fieldCaption: 'Profit', sortPriority: 2 },
        { fieldCaption: 'Region' },
      ]),
    ).not.toThrow();
  });

  it('should throw if a field has both function and calculation', () => {
    expect(() =>
      validateFields([{ fieldCaption: 'Sales', function: 'SUM', calculation: 'AVG([Sales])' }]),
    ).toThrow(
      'The query must not include fields that contain both a function and a calculation. The following fields contain both a function and a calculation: Sales.',
    );
  });

  it('should not throw if a field has only function or only calculation', () => {
    expect(() =>
      validateFields([
        { fieldCaption: 'Sales', function: 'SUM' },
        { fieldCaption: 'Profit', calculation: 'SUM([Profit])' },
      ]),
    ).not.toThrow();
  });

  it('should throw if a field has negative maxDecimalPlaces', () => {
    expect(() => validateFields([{ fieldCaption: 'Sales', maxDecimalPlaces: -1 }])).toThrow(
      'The query must not include fields that have a maxDecimalPlaces value that is less than 0. The following fields have a maxDecimalPlaces value that is less than 0: Sales.',
    );
  });

  it('should not throw if maxDecimalPlaces is 0 or positive', () => {
    expect(() =>
      validateFields([
        { fieldCaption: 'Sales', maxDecimalPlaces: 0 },
        { fieldCaption: 'Profit', maxDecimalPlaces: 2 },
      ]),
    ).not.toThrow();
  });
});
