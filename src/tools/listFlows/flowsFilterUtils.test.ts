import { parseAndValidateFlowFilterString } from './flowsFilterUtils.js';

describe('parseAndValidateFlowFilterString', () => {
  it('should return the filter string if valid (single expression)', () => {
    expect(parseAndValidateFlowFilterString('name:eq:SalesFlow')).toBe('name:eq:SalesFlow');
    expect(parseAndValidateFlowFilterString('createdAt:gt:2023-01-01T00:00:00Z')).toBe('createdAt:gt:2023-01-01T00:00:00Z');
  });

  it('should return the filter string if valid (multiple expressions)', () => {
    const filter = 'name:eq:SalesFlow,tags:in:tag1|tag2,createdAt:gte:2023-01-01T00:00:00Z';
    expect(parseAndValidateFlowFilterString(filter)).toBe(filter);
  });

  it('should throw if field is not supported', () => {
    expect(() => parseAndValidateFlowFilterString('foo:eq:bar')).toThrow('Unsupported filter field: foo');
  });

  it('should throw if operator is not supported', () => {
    expect(() => parseAndValidateFlowFilterString('name:like:SalesFlow')).toThrow('Unsupported filter operator: like');
  });

  it('should throw if value is missing', () => {
    expect(() => parseAndValidateFlowFilterString('name:eq')).toThrow('Missing value for filter: name:eq');
  });

  it('should return undefined if filter is undefined', () => {
    expect(parseAndValidateFlowFilterString(undefined)).toBeUndefined();
  });
}); 