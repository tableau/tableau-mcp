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
  if (
    !spec.measure.aggregation ||
    spec.measure.aggregation === 'AGGREGATION_UNSPECIFIED'
  ) {
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

  if (
    !ms.comparison.comparison ||
    ms.comparison.comparison === 'TIME_COMPARISON_UNSPECIFIED'
  ) {
    errors.push(
      'metric_specification.comparison.comparison must be set (e.g., TIME_COMPARISON_PREVIOUS_PERIOD, TIME_COMPARISON_YEAR_AGO_PERIOD).',
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
        if (
          !spec.measure.aggregation ||
          spec.measure.aggregation === 'AGGREGATION_UNSPECIFIED'
        ) {
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
      if (
        !ms.measurement_period.range ||
        ms.measurement_period.range === 'RANGE_UNSPECIFIED'
      ) {
        errors.push(`${ctxPrefix}measurement_period.range must be set.`);
      }
      if (
        !ms.comparison.comparison ||
        ms.comparison.comparison === 'TIME_COMPARISON_UNSPECIFIED'
      ) {
        errors.push(`${ctxPrefix}comparison.comparison must be set.`);
      }

      if (
        ctx.metric.extension_options.allowed_dimensions.length === 0 &&
        ctx.metric.extension_options.allowed_granularities.length === 0
      ) {
        errors.push(
          `${ctxPrefix}extension_options has empty allowed_dimensions and allowed_granularities. These should be populated from the metric definition.`,
        );
      }
    }
  }

  if (errors.length === 0) return null;

  return (
    'Payload validation failed before calling the Pulse Insights API. Fix the following issues:\n' +
    errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
  );
}
