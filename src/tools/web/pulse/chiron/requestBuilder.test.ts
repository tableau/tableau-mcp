import { describe, expect, it } from 'vitest';

import { buildChironRequests, ChironInsightRequest } from './requestBuilder.js';

const baseInput: ChironInsightRequest = {
  datasource: {
    id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
    isPublished: true,
  },
  schema: {
    fields: [
      {
        name: 'Sales',
        role: 'measure',
        dataType: 'number',
        supportedAggregations: ['AGGREGATION_SUM', 'AGGREGATION_AVERAGE'],
      },
      {
        name: 'Order Date',
        role: 'time',
        dataType: 'date',
      },
      {
        name: 'Region',
        role: 'dimension',
        dataType: 'string',
        allowedFilterValues: ['West', 'East'],
      },
    ],
  },
  context: {
    measureField: 'Sales',
    timeField: 'Order Date',
    dimensionFields: ['Region'],
    filters: [
      {
        field: 'Region',
        operator: 'OPERATOR_IN',
        values: ['West'],
      },
    ],
  },
  insight: {
    mode: 'trend',
    output: 'brief',
  },
  options: {
    aggregation: 'AGGREGATION_SUM',
    granularity: 'GRANULARITY_BY_MONTH',
    range: 'RANGE_CURRENT_PARTIAL',
    comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
    language: 'LANGUAGE_EN_US',
    locale: 'LOCALE_EN_US',
    timeZone: 'UTC',
  },
};

describe('buildChironRequests', () => {
  it('builds deterministic requests for the same input', () => {
    const first = buildChironRequests(baseInput);
    const second = buildChironRequests(baseInput);

    expect(first).toEqual(second);
  });

  it('omits metric_id/definition_id since Chiron has no stored metric or definition', () => {
    const built = buildChironRequests(baseInput);

    const bundleMetadata = built.bundleRequest.bundle_request.input.metadata;
    expect(bundleMetadata).not.toHaveProperty('metric_id');
    expect(bundleMetadata).not.toHaveProperty('definition_id');
    expect(bundleMetadata.name).toBe('Sales (trend)');

    const briefMetadata = built.briefRequest.messages[0].metric_group_context[0].metadata;
    expect(briefMetadata).not.toHaveProperty('metric_id');
    expect(briefMetadata).not.toHaveProperty('definition_id');
    expect(briefMetadata.name).toBe('Sales (trend)');

    // The datasource id remains the load-bearing key the Insights Service uses.
    expect(built.bundleRequest.bundle_request.input.metric.definition.datasource.id).toBe(
      baseInput.datasource.id,
    );
  });

  it('rejects unpublished datasource input', () => {
    expect(() =>
      buildChironRequests({
        ...baseInput,
        datasource: { ...baseInput.datasource, isPublished: false },
      }),
    ).toThrow('Local or unpublished datasources are not allowed.');
  });

  it('rejects unknown fields in context', () => {
    expect(() =>
      buildChironRequests({
        ...baseInput,
        context: {
          ...baseInput.context,
          measureField: 'Gross Sales',
        },
      }),
    ).toThrow('Field Gross Sales does not exist in the datasource schema.');
  });

  it('rejects filter values outside context-provided allowed values', () => {
    expect(() =>
      buildChironRequests({
        ...baseInput,
        context: {
          ...baseInput.context,
          filters: [
            {
              field: 'Region',
              operator: 'OPERATOR_IN',
              values: ['South'],
            },
          ],
        },
      }),
    ).toThrow('Filter value South is not allowed for field Region.');
  });
});
