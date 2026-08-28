import {
  applyFieldNameResolution,
  buildFieldNameByCaption,
  resolveIdTypeFromContentUrl,
} from './resolveBundleRequestFieldNames.js';

describe('resolveBundleRequestFieldNames', () => {
  describe('buildFieldNameByCaption', () => {
    it('maps caption to fieldName, skipping fields missing either', () => {
      const map = buildFieldNameByCaption([
        { fieldCaption: 'Sales', fieldName: 'Calculation_123' },
        { fieldCaption: 'Order Date', fieldName: 'Order Date' },
        { fieldCaption: 'Missing Field Name' },
        { fieldName: 'Missing Caption' },
      ]);

      expect(map.get('Sales')).toBe('Calculation_123');
      expect(map.get('Order Date')).toBe('Order Date');
      expect(map.size).toBe(2);
    });
  });

  describe('resolveIdTypeFromContentUrl', () => {
    it('returns the workbook datasource id_type for an embedded contentUrl', () => {
      expect(resolveIdTypeFromContentUrl('$embedded$_857cae8f-aaee-4e7a-ad78')).toBe(
        'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
      );
    });

    it('returns undefined for a published contentUrl', () => {
      expect(resolveIdTypeFromContentUrl('SalesCloud')).toBeUndefined();
    });

    it('returns undefined when contentUrl is undefined', () => {
      expect(resolveIdTypeFromContentUrl(undefined)).toBeUndefined();
    });
  });

  describe('applyFieldNameResolution', () => {
    const baseRequest = {
      bundle_request: {
        version: 1 as const,
        options: {
          output_format: 'OUTPUT_FORMAT_HTML' as const,
          time_zone: 'UTC',
          language: 'LANGUAGE_EN_US' as const,
          locale: 'LOCALE_EN_US' as const,
        },
        input: {
          metadata: { name: 'Metric' },
          metric: {
            definition: {
              datasource: { id: 'ds-luid' },
              basic_specification: {
                measure: { field: 'Sales', aggregation: 'AGGREGATION_SUM' as const },
                time_dimension: { field: 'Order Date' },
                filters: [{ field: 'Region', operator: 'OPERATOR_EQUAL' as const }],
              },
              is_running_total: false,
            },
            metric_specification: {
              filters: [{ field: 'Segment', operator: 'OPERATOR_EQUAL' as const }],
              measurement_period: {
                granularity: 'GRANULARITY_BY_MONTH' as const,
                range: 'RANGE_LAST_COMPLETE' as const,
              },
              comparison: { comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' as const },
            },
            extension_options: {
              allowed_dimensions: ['Region'],
              allowed_granularities: [],
              offset_from_today: 0,
            },
          },
        },
      },
    };

    it('rewrites measure, time_dimension, filters, and allowed_dimensions to fieldNames', () => {
      const fieldNameByCaption = new Map([
        ['Sales', 'Calculation_123'],
        ['Region', 'Calculation_456'],
      ]);

      const result = applyFieldNameResolution(baseRequest as any, fieldNameByCaption);
      const metric = result.bundle_request.input.metric;

      expect(metric.definition.basic_specification.measure.field).toBe('Calculation_123');
      // Not in the map -> forwarded unchanged rather than dropped.
      expect(metric.definition.basic_specification.time_dimension.field).toBe('Order Date');
      expect(metric.definition.basic_specification.filters[0].field).toBe('Calculation_456');
      expect(metric.metric_specification.filters?.[0].field).toBe('Segment');
      expect(metric.extension_options?.allowed_dimensions).toEqual(['Calculation_456']);
      expect(metric.definition.datasource).toEqual({ id: 'ds-luid' });
    });

    it('sets id_type when provided', () => {
      const result = applyFieldNameResolution(
        baseRequest as any,
        new Map(),
        'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
      );

      expect(result.bundle_request.input.metric.definition.datasource).toEqual({
        id: 'ds-luid',
        id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
      });
    });

    it('leaves datasource unchanged when idType is undefined', () => {
      const result = applyFieldNameResolution(baseRequest as any, new Map());

      expect(result.bundle_request.input.metric.definition.datasource).toEqual({
        id: 'ds-luid',
      });
    });
  });
});
