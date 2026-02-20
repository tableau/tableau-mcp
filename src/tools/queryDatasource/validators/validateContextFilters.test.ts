import { Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateContextFilters } from './validateContextFilters.js';

const baseFields: Query['fields'] = [
  { fieldCaption: 'Product Name' },
  { fieldCaption: 'Sales', function: 'SUM', sortDirection: 'DESC', sortPriority: 1 },
];

const topFilter = {
  field: { fieldCaption: 'Product Name' },
  filterType: 'TOP' as const,
  howMany: 5,
  direction: 'TOP' as const,
  fieldToMeasure: { fieldCaption: 'Sales', function: 'SUM' as const },
};

describe('validateContextFilters', () => {
  describe('no warnings', () => {
    it('should return no warnings when query has no filters', () => {
      const query: Query = { fields: baseFields };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should return no warnings when query has empty filters', () => {
      const query: Query = { fields: baseFields, filters: [] };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should return no warnings for a single filter', () => {
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'State' },
            filterType: 'SET',
            values: ['Massachusetts'],
          },
        ],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should return no warnings for a single TOP filter', () => {
      const query: Query = {
        fields: baseFields,
        filters: [topFilter],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should return no warnings for multiple dimension filters without TOP', () => {
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'State' },
            filterType: 'SET',
            values: ['Massachusetts'],
          },
          {
            field: { fieldCaption: 'Category' },
            filterType: 'SET',
            values: ['Technology'],
          },
        ],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should return no warnings when dimension filters already have context: true', () => {
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'State' },
            filterType: 'SET',
            values: ['Massachusetts'],
            context: true,
          },
          topFilter,
        ],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should not warn for aggregated measure QUANTITATIVE_NUMERICAL filter (has function)', () => {
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'Profit', function: 'SUM' },
            filterType: 'QUANTITATIVE_NUMERICAL',
            quantitativeFilterType: 'RANGE',
            min: 0,
            max: 1000,
          },
          topFilter,
        ],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });

    it('should not warn for aggregated measure QUANTITATIVE_DATE filter (has function)', () => {
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'Order Date', function: 'YEAR' },
            filterType: 'QUANTITATIVE_DATE',
            quantitativeFilterType: 'RANGE',
            minDate: '2024-01-01',
            maxDate: '2024-12-31',
          },
          topFilter,
        ],
      };
      expect(validateContextFilters(query)).toEqual([]);
    });
  });

  describe('warnings', () => {
    it('should warn when TOP filter is combined with SET filter missing context', () => {
      const setFilter = {
        field: { fieldCaption: 'State' },
        filterType: 'SET' as const,
        values: ['Massachusetts'],
      };
      const query: Query = {
        fields: baseFields,
        filters: [setFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].type).toBe('MISSING_CONTEXT_ON_DIMENSION_FILTER');
      expect(warnings[0].severity).toBe('WARNING');
      expect(warnings[0].affectedFilters).toEqual(['State']);
      expect(warnings[0].message).toContain("missing 'context: true'");
    });

    it('should warn when BOTTOM direction is used with dimension filter missing context', () => {
      const setFilter = {
        field: { fieldCaption: 'Region' },
        filterType: 'SET' as const,
        values: ['East'],
      };
      const query: Query = {
        fields: baseFields,
        filters: [
          setFilter,
          { ...topFilter, howMany: 3, direction: 'BOTTOM' as const },
        ],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['Region']);
    });

    it('should list multiple affected filters', () => {
      const stateFilter = {
        field: { fieldCaption: 'State' },
        filterType: 'SET' as const,
        values: ['Massachusetts'],
      };
      const categoryFilter = {
        field: { fieldCaption: 'Category' },
        filterType: 'SET' as const,
        values: ['Technology'],
      };
      const query: Query = {
        fields: baseFields,
        filters: [stateFilter, categoryFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['State', 'Category']);
    });

    it('should detect DATE filter missing context with TOP filter', () => {
      const dateFilter = {
        field: { fieldCaption: 'Order Date' },
        filterType: 'DATE' as const,
        periodType: 'YEARS' as const,
        dateRangeType: 'LAST' as const,
      };
      const query: Query = {
        fields: baseFields,
        filters: [dateFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['Order Date']);
    });

    it('should detect MATCH filter missing context with TOP filter', () => {
      const matchFilter = {
        field: { fieldCaption: 'Customer Name' },
        filterType: 'MATCH' as const,
        contains: 'Smith',
      };
      const query: Query = {
        fields: baseFields,
        filters: [matchFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['Customer Name']);
    });

    it('should detect dimension QUANTITATIVE_NUMERICAL filter missing context (no function)', () => {
      const quantFilter = {
        field: { fieldCaption: 'Price' },
        filterType: 'QUANTITATIVE_NUMERICAL' as const,
        quantitativeFilterType: 'RANGE' as const,
        min: 10,
        max: 500,
      };
      const query: Query = {
        fields: baseFields,
        filters: [quantFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['Price']);
    });

    it('should detect dimension QUANTITATIVE_DATE filter missing context (no function)', () => {
      const dateFilter = {
        field: { fieldCaption: 'Order Date' },
        filterType: 'QUANTITATIVE_DATE' as const,
        quantitativeFilterType: 'RANGE' as const,
        minDate: '2024-01-01',
        maxDate: '2024-12-31',
      };
      const query: Query = {
        fields: baseFields,
        filters: [dateFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['Order Date']);
    });

    it('should still flag dimension filters that have context: false', () => {
      const setFilter = {
        field: { fieldCaption: 'State' },
        filterType: 'SET' as const,
        values: ['Massachusetts'],
        context: false,
      };
      const query: Query = {
        fields: baseFields,
        filters: [setFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['State']);
    });

    it('should warn for calculated filter fields missing context', () => {
      const calcFilter = {
        field: { calculation: 'IF [Sales] > 100 THEN "High" ELSE "Low" END' },
        filterType: 'QUANTITATIVE_NUMERICAL' as const,
        quantitativeFilterType: 'RANGE' as const,
        min: 0,
        max: 500,
      };
      const query: Query = {
        fields: baseFields,
        filters: [calcFilter, topFilter],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual([
        'IF [Sales] > 100 THEN "High" ELSE "Low" END',
      ]);
    });

    it('should handle mixed filter types correctly', () => {
      const setFilter = {
        field: { fieldCaption: 'State' },
        filterType: 'SET' as const,
        values: ['Massachusetts'],
      };
      const query: Query = {
        fields: baseFields,
        filters: [
          {
            field: { fieldCaption: 'Profit', function: 'SUM' as const },
            filterType: 'QUANTITATIVE_NUMERICAL' as const,
            quantitativeFilterType: 'RANGE' as const,
            min: 0,
            max: 500,
          },
          setFilter,
          topFilter,
        ],
      };

      const warnings = validateContextFilters(query);
      expect(warnings).toHaveLength(1);
      expect(warnings[0].affectedFilters).toEqual(['State']);
    });
  });
});
