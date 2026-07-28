import z from 'zod';

import {
  pulseBundleRequestSchema,
  pulseInsightBriefRequestSchema,
} from '../../../sdks/tableau/types/pulse.js';

type BundleRequest = z.infer<typeof pulseBundleRequestSchema>;
type BriefRequest = z.infer<typeof pulseInsightBriefRequestSchema>;

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

  // specific_period is read by the service ONLY when range is RANGE_BY_CONFIG; in
  // any other range it is silently ignored, which would return an insight for the
  // wrong (today-relative) period instead of the requested span. Fail closed.
  if (ms.measurement_period.specific_period && ms.measurement_period.range !== 'RANGE_BY_CONFIG') {
    errors.push(
      `measurement_period.specific_period is only honored when measurement_period.range is 'RANGE_BY_CONFIG' (got '${ms.measurement_period.range}'). ` +
        "For a today-relative window drop specific_period; to analyze the explicit period/span set range to 'RANGE_BY_CONFIG'.",
    );
  }

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
    }
  }

  if (errors.length === 0) return null;

  return (
    'Payload validation failed before calling the Pulse Insights API. Fix the following issues:\n' +
    errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  );
}
