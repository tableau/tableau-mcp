import { Err, Ok } from 'ts-results-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';
import { Server } from '../../../server.js';
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'East' },
          { DistinctValues: 'West' },
          { DistinctValues: 'North' },
          { DistinctValues: 'South' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'John Doe' },
          { SampleValues: 'Jane Smith' },
          { SampleValues: 'John Johnson' },
          { SampleValues: 'Bob Wilson' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'Apple MacBook Pro' },
          { SampleValues: 'Apple iPad' },
          { SampleValues: 'Samsung Galaxy Pro' },
          { SampleValues: 'Dell Laptop' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>)
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(new Err({ errorCode: '404934', message: 'Field not found' }));

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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
          values: ['Electronis'], // Close typo for 'Electronics'
        },
      ],
    };

    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
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

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

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

  it('should use random sampling when no fuzzy matches are found for SET filters', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Region' }],
      filters: [
        {
          field: { fieldCaption: 'Region' },
          filterType: 'SET',
          values: ['XYZ123'], // Very different from any real values
        },
      ],
    };

    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'East' },
          { DistinctValues: 'West' },
          { DistinctValues: 'North' },
          { DistinctValues: 'South' },
          { DistinctValues: 'Central' },
          { DistinctValues: 'Northeast' },
          { DistinctValues: 'Southwest' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Region');
      expect(result.error[0].invalidValues).toEqual(['XYZ123']);
      // Should have 5 random samples since no fuzzy matches found
      expect(result.error[0].sampleValues).toHaveLength(5);
      // Should contain valid region values (random sampling fallback)
      const validRegions = ['East', 'West', 'North', 'South', 'Central', 'Northeast', 'Southwest'];
      result.error[0].sampleValues.forEach((sample) => {
        expect(validRegions).toContain(sample);
      });
      expect(result.error[0].message).toContain('Did you mean:');
    }
  });

  it('should use random sampling when array is smaller than requested count', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Status' }],
      filters: [
        {
          field: { fieldCaption: 'Status' },
          filterType: 'SET',
          values: ['InvalidStatus'],
        },
      ],
    };

    // Mock with only 3 values, but getFuzzyMatches will try to get up to 5
    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'Active' },
          { DistinctValues: 'Inactive' },
          { DistinctValues: 'Pending' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Status');
      expect(result.error[0].invalidValues).toEqual(['InvalidStatus']);
      // Should return all 3 available values since array is smaller than requested count
      expect(result.error[0].sampleValues).toHaveLength(3);
      expect(result.error[0].sampleValues).toEqual(
        expect.arrayContaining(['Active', 'Inactive', 'Pending']),
      );
    }
  });

  it('should combine fuzzy matches with random sampling when not enough fuzzy matches are found', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Product' }],
      filters: [
        {
          field: { fieldCaption: 'Product' },
          filterType: 'SET',
          values: ['Chair', 'XYZ999'], // 'Chair' has fuzzy match, 'XYZ999' doesn't
        },
      ],
    };

    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { DistinctValues: 'Chairs' }, // Close match for 'Chair'
          { DistinctValues: 'Table' },
          { DistinctValues: 'Desk' },
          { DistinctValues: 'Bookshelf' },
          { DistinctValues: 'Cabinet' },
          { DistinctValues: 'Sofa' },
          { DistinctValues: 'Bed' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Product');
      expect(result.error[0].invalidValues).toEqual(['Chair', 'XYZ999']);
      // Should have fuzzy match for 'Chair' plus random samples to fill up to 5
      expect(result.error[0].sampleValues).toHaveLength(5);
      expect(result.error[0].sampleValues).toContain('Chairs'); // Fuzzy match for 'Chair'
      // Should also contain other random samples
      const allProducts = ['Chairs', 'Table', 'Desk', 'Bookshelf', 'Cabinet', 'Sofa', 'Bed'];
      result.error[0].sampleValues.forEach((sample) => {
        expect(allProducts).toContain(sample);
      });
    }
  });

  it('should use random sampling for MATCH filters when no similar values are found', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'Customer Name' }],
      filters: [
        {
          field: { fieldCaption: 'Customer Name' },
          filterType: 'MATCH',
          startsWith: 'XYZ', // No customer names start with XYZ
        },
      ],
    };

    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'Alice Johnson' },
          { SampleValues: 'Bob Smith' },
          { SampleValues: 'Carol Williams' },
          { SampleValues: 'David Brown' },
          { SampleValues: 'Emily Davis' },
          { SampleValues: 'Frank Miller' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('Customer Name');
      expect(result.error[0].invalidValues).toEqual(['starts with "XYZ"']);
      // Should fall back to random sampling since no similar values found
      expect(result.error[0].sampleValues).toHaveLength(5);
      const allCustomers = [
        'Alice Johnson',
        'Bob Smith',
        'Carol Williams',
        'David Brown',
        'Emily Davis',
        'Frank Miller',
      ];
      result.error[0].sampleValues.forEach((sample) => {
        expect(allCustomers).toContain(sample);
      });
      expect(result.error[0].message).toContain('Similar values in this field:');
    }
  });

  it('should use fuzzy sampling for MATCH filters with startsWith, endsWith and contains', async () => {
    const query: Query = {
      fields: [{ fieldCaption: 'State/Province' }],
      filters: [
        {
          field: { fieldCaption: 'State/Province' },
          filterType: 'MATCH',
          startsWith: 'Mi',
          endsWith: 'ti',
          contains: 'ss',
        },
      ],
    };

    (
      mockVizqlDataServiceMethods.queryDatasource as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      new Ok({
        data: [
          { SampleValues: 'Alaska' },
          { SampleValues: 'California' },
          { SampleValues: 'Florida' },
          { SampleValues: 'Georgia' },
          { SampleValues: 'Hawaii' },
          { SampleValues: 'Illinois' },
          { SampleValues: 'Indiana' },
          { SampleValues: 'Iowa' },
          { SampleValues: 'Kansas' },
          { SampleValues: 'Kentucky' },
          { SampleValues: 'Louisiana' },
          { SampleValues: 'Maine' },
          { SampleValues: 'Maryland' },
          { SampleValues: 'Massachusetts' },
          { SampleValues: 'Michsigani' },
          { SampleValues: 'Minnesota' },
          { SampleValues: 'Mississippi' },
          { SampleValues: 'Missouri' },
        ],
      }),
    );

    const result = await validateFilterValues(
      new Server(),
      query,
      mockVizqlDataServiceMethods,
      mockDatasource,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0].field).toBe('State/Province');
      expect(result.error[0].invalidValues).toEqual([
        'starts with "Mi"',
        'ends with "ti"',
        'contains "ss"',
      ]);
      expect(result.error[0].sampleValues).toHaveLength(5);
      const fuzzyMatchStates = [
        'Massachusetts',
        'Michsigani',
        'Minnesota',
        'Mississippi',
        'Missouri',
      ];
      result.error[0].sampleValues.forEach((sample) => {
        expect(fuzzyMatchStates).toContain(sample);
      });
      expect(result.error[0].message).toContain('Similar values in this field:');
    }
  });
});
