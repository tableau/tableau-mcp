import { Err, Ok } from 'ts-results-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';
import { Query } from '../queryDatasourceValidator.js';
import { validateFilterValues } from './validateFilterValues.js';

// Mock the VizqlDataServiceMethods
const mockVizqlDataServiceMethods = {
  queryDatasource: vi.fn(),
} as unknown as VizqlDataServiceMethods;

const mockDatasource = {
  datasourceLuid: 'test-datasource-luid',
};

describe('validateFilterValues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return Ok when no filters are present', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
    };

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
  });

  it('should return Ok when no SET or MATCH filters are present', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Sales' },
          filterType: 'QUANTITATIVE_NUMERICAL',
          quantitativeFilterType: 'MIN',
          min: 1000,
        },
      ],
    };

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
  });

  it('should validate SET filter with valid values', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East', 'West'],
        },
      ],
    };

    // Mock successful query returning existing values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'East' },
          { DistinctValues: 'West' },
          { DistinctValues: 'North' },
          { DistinctValues: 'South' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
  });

  it('should return error for SET filter with invalid values and suggest fuzzy matches', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East', 'Wast'], // 'Wast' is a typo for 'West'
        },
      ],
    };

    // Mock successful query returning existing values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'East' },
          { DistinctValues: 'West' },
          { DistinctValues: 'North' },
          { DistinctValues: 'South' },
          { DistinctValues: 'Central' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Region');
      expect(result.error[0].invalidValues).toEqual(['Wast']);
      expect(result.error[0].sampleValues).toContain('West'); // Should contain fuzzy match
      expect(result.error[0].message).toContain('Filter validation failed for field "Region"');
      expect(result.error[0].message).toContain('Wast');
      expect(result.error[0].message).toContain('Did you mean:');
      expect(result.error[0].message).toContain(
        'evaluate whether you included the wrong filter value',
      );
    }
  });

  it('should return error for SET filter with completely invalid values', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['InvalidRegion'],
        },
      ],
    };

    // Mock successful query returning existing values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'East' },
          { DistinctValues: 'West' },
          { DistinctValues: 'North' },
          { DistinctValues: 'South' },
          { DistinctValues: 'Central' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Region');
      expect(result.error[0].invalidValues).toEqual(['InvalidRegion']);
      expect(result.error[0].sampleValues).toHaveLength(5); // Should fallback to random samples when no fuzzy matches
      expect(result.error[0].message).toContain('Filter validation failed for field "Region"');
      expect(result.error[0].message).toContain('InvalidRegion');
      expect(result.error[0].message).toContain('Did you mean:');
      expect(result.error[0].message).toContain(
        'evaluate whether you included the wrong filter value',
      );
    }
  });

  it('should validate MATCH filter with valid pattern', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Customer Name' },
          filterType: 'MATCH',
          startsWith: 'John',
        },
      ],
    };

    // Mock successful query returning sample values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'John Doe' },
          { SampleValues: 'Jane Smith' },
          { SampleValues: 'John Johnson' },
          { SampleValues: 'Bob Wilson' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
  });

  it('should return error for MATCH filter with invalid pattern and suggest similar values', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Customer Name' },
          filterType: 'MATCH',
          startsWith: 'Jon', // Similar to 'John' but no exact matches
        },
      ],
    };

    // Mock successful query returning sample values that don't match exactly but are similar
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'John Doe' },
          { SampleValues: 'Jane Smith' },
          { SampleValues: 'Bob Wilson' },
          { SampleValues: 'Alice Brown' },
          { SampleValues: 'Charlie Davis' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Customer Name');
      expect(result.error[0].invalidValues).toEqual(['starts with "Jon"']);
      expect(result.error[0].sampleValues).toContain('John Doe'); // Should contain similar value
      expect(result.error[0].message).toContain(
        'Filter validation failed for field "Customer Name"',
      );
      expect(result.error[0].message).toContain('starts with "Jon"');
      expect(result.error[0].message).toContain('Similar values in this field:');
      expect(result.error[0].message).toContain(
        'evaluate whether you included the wrong filter value',
      );
    }
  });

  it('should return error for MATCH filter with completely invalid pattern', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Customer Name' },
          filterType: 'MATCH',
          startsWith: 'XYZ123', // Completely different pattern
        },
      ],
    };

    // Mock successful query returning sample values that don't match
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'John Doe' },
          { SampleValues: 'Jane Smith' },
          { SampleValues: 'Bob Wilson' },
          { SampleValues: 'Alice Brown' },
          { SampleValues: 'Charlie Davis' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Customer Name');
      expect(result.error[0].invalidValues).toEqual(['starts with "XYZ123"']);
      expect(result.error[0].sampleValues).toHaveLength(5); // Should fallback to random samples
      expect(result.error[0].message).toContain(
        'Filter validation failed for field "Customer Name"',
      );
      expect(result.error[0].message).toContain('starts with "XYZ123"');
      expect(result.error[0].message).toContain('Similar values in this field:');
      expect(result.error[0].message).toContain(
        'evaluate whether you included the wrong filter value',
      );
    }
  });

  it('should handle complex MATCH filter with multiple patterns', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Product Name' },
          filterType: 'MATCH',
          startsWith: 'Apple',
          endsWith: 'Pro',
        },
      ],
    };

    // Mock successful query returning sample values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'Apple MacBook Pro' },
          { SampleValues: 'Apple iPad' },
          { SampleValues: 'Samsung Galaxy Pro' },
          { SampleValues: 'Dell Laptop' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
  });

  it('should handle multiple filter validation errors with fuzzy matching', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['Wast'], // Typo for 'West'
        },
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['Electronicss'], // Typo for 'Electronics'
        },
      ],
    };

    // Mock successful queries returning existing values
    (mockVizqlDataServiceMethods.queryDatasource as any)
      .mockResolvedValueOnce(
        new Ok({
          data: [
            { DistinctValues: 'East' },
            { DistinctValues: 'West' },
            { DistinctValues: 'North' },
            { DistinctValues: 'South' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          data: [
            { DistinctValues: 'Electronics' },
            { DistinctValues: 'Furniture' },
            { DistinctValues: 'Office Supplies' },
          ],
        }),
      );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(2);
      expect(result.error[0].field).toBe('Region');
      expect(result.error[0].sampleValues).toContain('West'); // Should suggest 'West' for 'Wast'
      expect(result.error[1].field).toBe('Category');
      expect(result.error[1].sampleValues).toContain('Electronics'); // Should suggest 'Electronics' for 'Electronicss'
    }
  });

  it('should handle validation query errors gracefully', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['East'],
        },
      ],
    };

    // Mock failed query
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Err({ errorCode: '404934', message: 'Field not found' }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    // Should return Ok when validation query fails (graceful degradation)
    expect(result.isOk()).toBe(true);
  });

  it('should skip validation for filters without fieldCaption', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: '' }, // Empty fieldCaption should be skipped
          filterType: 'SET',
          values: ['test'],
        },
      ],
    };

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isOk()).toBe(true);
    expect(mockVizqlDataServiceMethods.queryDatasource).not.toHaveBeenCalled();
  });

  it('should provide fuzzy matches for close typos in SET filters', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Sales' }],
      filters: [
        {
          field: { fieldCaption: 'Category' },
          filterType: 'SET',
          values: ['Electronis'], // Missing 'c' from 'Electronics'
        },
      ],
    };

    // Mock successful query returning existing values
    (mockVizqlDataServiceMethods.queryDatasource as any).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'Electronics' },
          { DistinctValues: 'Furniture' },
          { DistinctValues: 'Office Supplies' },
          { DistinctValues: 'Technology' },
          { DistinctValues: 'Appliances' },
        ],
      }),
    );

    const result = await validateFilterValues(query, mockVizqlDataServiceMethods, mockDatasource);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Category');
      expect(result.error[0].invalidValues).toEqual(['Electronis']);
      expect(result.error[0].sampleValues).toContain('Electronics'); // Should suggest the closest match
      expect(result.error[0].message).toContain('Did you mean:');
      expect(result.error[0].message).toContain('Electronics');
    }
  });
});
