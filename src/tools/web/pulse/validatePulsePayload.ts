import z from 'zod';

import {
  pulseBundleRequestSchema,
  pulseInsightBriefRequestSchema,
} from '../../../sdks/tableau/types/pulse.js';

type BundleRequest = z.infer<typeof pulseBundleRequestSchema>;
type BriefRequest = z.infer<typeof pulseInsightBriefRequestSchema>;
type MeasurementPeriod =
  BundleRequest['bundle_request']['input']['metric']['metric_specification']['measurement_period'];

function validateMeasurementPeriod(
  measurementPeriod: MeasurementPeriod,
  errorPrefix = '',
): string[] {
  const errors: string[] = [];

  // Both Bundle and Insight Brief use the shared Pulse metric specification.
  // The service ignores these configurations outside RANGE_BY_CONFIG, so every
  // entry point must fail closed rather than return an insight for another period.
  if (measurementPeriod.specific_period && measurementPeriod.range !== 'RANGE_BY_CONFIG') {
    errors.push(
      `${errorPrefix}measurement_period.specific_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG' (got '${measurementPeriod.range}'). ` +
        "For a today-relative window drop specific_period; to analyze the explicit period/span set range to 'RANGE_BY_CONFIG'.",
    );
  }

  const lastXPeriod = measurementPeriod.last_x_period;
  if (lastXPeriod && measurementPeriod.range !== 'RANGE_BY_CONFIG') {
    errors.push(
      `${errorPrefix}measurement_period.last_x_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG' (got '${measurementPeriod.range}').`,
    );
  }
  if (lastXPeriod && measurementPeriod.specific_period) {
    errors.push(
      `${errorPrefix}measurement_period.last_x_period and measurement_period.specific_period cannot both be set — use last_x_period for a supported rolling window or specific_period for a fixed span.`,
    );
  }
  if (
    lastXPeriod?.period_type === 'GRANULARITY_BY_DAY' &&
    measurementPeriod.granularity !== 'GRANULARITY_BY_DAY'
  ) {
    errors.push(
      `${errorPrefix}a day-based measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_DAY'.`,
    );
  }
  if (
    lastXPeriod?.period_type === 'GRANULARITY_BY_YEAR' &&
    measurementPeriod.granularity !== 'GRANULARITY_BY_MONTH'
  ) {
    errors.push(
      `${errorPrefix}the trailing-year measurement_period.last_x_period requires measurement_period.granularity = 'GRANULARITY_BY_MONTH'.`,
    );
  }

  return errors;
}

/**
 * Pre-flight validation for Pulse Insights bundle requests.
 * Catches the most common API-rejection causes that the Zod schema
 * doesn't express — conditional field requirements, UNSPECIFIED enum
 * values, and conflicting options.
 *
 * Returns null if valid, or a human-readable error string.
 */
export function validateBundleRequest(req: BundleRequest): string | null {
  const errors: string[] = [];
  const br = req.bundle_request;

  if (br.version !== 1) {
    errors.push(`version must be 1 (got ${br.version}).`);
  }

  const spec = br.input.metric.definition.basic_specification;
  if (!spec.measure.field) {
    errors.push('basic_specification.measure.field is empty.');
  }
  if (!spec.measure.aggregation || spec.measure.aggregation === 'AGGREGATION_UNSPECIFIED') {
    errors.push(
      'basic_specification.measure.aggregation must be set (e.g., AGGREGATION_SUM, AGGREGATION_AVERAGE). Got: ' +
        (spec.measure.aggregation || '(empty)') +
        '.',
    );
  }

  const ms = br.input.metric.metric_specification;

  if (
    !ms.measurement_period.granularity ||
    ms.measurement_period.granularity === 'GRANULARITY_UNSPECIFIED'
  ) {
    errors.push(
      'metric_specification.measurement_period.granularity must be set (e.g., GRANULARITY_BY_DAY, GRANULARITY_BY_WEEK, GRANULARITY_BY_MONTH).',
    );
  }

  if (!ms.measurement_period.range || ms.measurement_period.range === 'RANGE_UNSPECIFIED') {
    errors.push(
      'metric_specification.measurement_period.range must be set (e.g., RANGE_CURRENT_PARTIAL, RANGE_LAST_COMPLETE).',
    );
  }

  if (!ms.comparison.comparison || ms.comparison.comparison === 'TIME_COMPARISON_UNSPECIFIED') {
    errors.push(
      'metric_specification.comparison.comparison must be set (e.g., TIME_COMPARISON_PREVIOUS_PERIOD, TIME_COMPARISON_YEAR_AGO_PERIOD).',
    );
  }

  errors.push(...validateMeasurementPeriod(ms.measurement_period));

  const lastXPeriod = ms.measurement_period.last_x_period;

  // `options.now` (anchor a whole relative period) and `specific_period` (an
  // explicit period/span under RANGE_BY_CONFIG) are two different ways to move the
  // window, and their combined precedence at the service is unconfirmed. Reject
  // setting both so a request can't depend on undefined precedence — pick one.
  if (br.options.now && ms.measurement_period.specific_period) {
    errors.push(
      'options.now and measurement_period.specific_period cannot both be set — they are alternative ways to target a period. ' +
        'Use options.now to anchor a relative whole period, or specific_period (with range RANGE_BY_CONFIG) for an explicit period/span.',
    );
  }
  if (br.options.now && lastXPeriod) {
    errors.push(
      'options.now and measurement_period.last_x_period cannot both be set — rolling windows are relative to the live data offset.',
    );
  }

  const hasRangeAndComparison =
    ms.measurement_period.range &&
    ms.measurement_period.range !== 'RANGE_UNSPECIFIED' &&
    ms.comparison.comparison &&
    ms.comparison.comparison !== 'TIME_COMPARISON_UNSPECIFIED' &&
    ms.comparison.comparison !== 'TIME_COMPARISON_NONE';

  if (hasRangeAndComparison && !spec.time_dimension.field) {
    errors.push(
      'basic_specification.time_dimension.field is required when measurement_period.range and comparison are specified.',
    );
  }

  if (
    br.input.metric.definition.is_running_total &&
    spec.measure.aggregation === 'AGGREGATION_USER'
  ) {
    errors.push('is_running_total cannot be true with AGGREGATION_USER.');
  }

  if (!br.input.metric.definition.datasource.id) {
    errors.push('definition.datasource.id is empty.');
  }

  if (errors.length === 0) return null;

  return (
    'Payload validation failed before calling the Pulse Insights API. Fix the following issues:\n' +
    errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  );
}

/**
 * Pre-flight validation for Pulse Insights brief requests.
 * Catches common issues with the metric_group_context that the
 * Zod schema doesn't express.
 */
export function validateBriefRequest(req: BriefRequest): string | null {
  const errors: string[] = [];

  if (!req.messages || req.messages.length === 0) {
    errors.push('messages array is empty. At least one message is required.');
  }

  for (let mi = 0; mi < (req.messages?.length ?? 0); mi++) {
    const msg = req.messages[mi];
    const prefix = req.messages.length > 1 ? `messages[${mi}]: ` : '';

    if (!msg.content) {
      errors.push(`${prefix}content is empty. Provide a question or prompt.`);
    }

    if (!msg.metric_group_context || msg.metric_group_context.length === 0) {
      errors.push(`${prefix}metric_group_context is empty. At least one metric is required.`);
      continue;
    }

    for (let ci = 0; ci < msg.metric_group_context.length; ci++) {
      const ctx = msg.metric_group_context[ci];
      const ctxPrefix = `${prefix}metric_group_context[${ci}]: `;

      if (!ctx.metric.definition.datasource.id) {
        errors.push(`${ctxPrefix}definition.datasource.id is empty.`);
      }

      const spec = ctx.metric.definition.basic_specification;
      if (spec) {
        if (!spec.measure.field) {
          errors.push(`${ctxPrefix}measure.field is empty.`);
        }
        if (!spec.measure.aggregation || spec.measure.aggregation === 'AGGREGATION_UNSPECIFIED') {
          errors.push(`${ctxPrefix}measure.aggregation must be set (not UNSPECIFIED).`);
        }
      }

      const ms = ctx.metric.metric_specification;
      if (
        !ms.measurement_period.granularity ||
        ms.measurement_period.granularity === 'GRANULARITY_UNSPECIFIED'
      ) {
        errors.push(`${ctxPrefix}measurement_period.granularity must be set.`);
      }
      if (!ms.measurement_period.range || ms.measurement_period.range === 'RANGE_UNSPECIFIED') {
        errors.push(`${ctxPrefix}measurement_period.range must be set.`);
      }
      if (!ms.comparison.comparison || ms.comparison.comparison === 'TIME_COMPARISON_UNSPECIFIED') {
        errors.push(`${ctxPrefix}comparison.comparison must be set.`);
      }

      errors.push(...validateMeasurementPeriod(ms.measurement_period, ctxPrefix));
    }
  }

  if (errors.length === 0) return null;

  return (
    'Payload validation failed before calling the Pulse Insights API. Fix the following issues:\n' +
    errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  );
}
