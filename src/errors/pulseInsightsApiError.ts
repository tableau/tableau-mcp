const PULSE_INSIGHTS_ERROR_GUIDANCE: Record<string, string> = {
  '400712':
    'Missing measure or measure field name. Ensure basic_specification.measure.field is a non-empty string.',
  '400713':
    'Unknown or missing measure aggregation. Set basic_specification.measure.aggregation to a valid value (e.g., AGGREGATION_SUM, AGGREGATION_AVERAGE, AGGREGATION_USER).',
  '400714':
    'Missing time dimension or time dimension field name. Ensure basic_specification.time_dimension.field is set.',
  '400732':
    'Invalid measurement period. Check that the date format is YYYY-MM-DD and that start/end dates are valid.',
  '400734': 'Invalid offset_from_today. Value must be between 0 and 365 inclusive.',
  '400940': 'Invalid filter: missing field name or unknown/unspecified operator.',
  '400941':
    'Invalid filter values: no values provided, or mixed string and boolean data types in the same filter.',
  '400945':
    'No measurement period present. Set metric_specification.measurement_period with both granularity and range.',
  '400946':
    'No granularity specified. Set measurement_period.granularity (e.g., GRANULARITY_BY_DAY, GRANULARITY_BY_WEEK, GRANULARITY_BY_MONTH).',
  '400947':
    'No range specified. Set measurement_period.range (e.g., RANGE_CURRENT_PARTIAL, RANGE_LAST_COMPLETE).',
  '400948':
    'No comparison config present. Set metric_specification.comparison with a valid comparison type.',
  '400949':
    'No comparison type specified, or BY_CONFIG comparison is missing the required specific_comparison config.',
  '400955': 'AI-powered insights (GAI) is not enabled for this site.',
  '400958': 'Missing or incorrectly formatted field ID in field values request.',
  '400960': 'Field ID not set in the request.',
  '400969': 'Conflicting options: is_running_total cannot be true when is_summable is false.',
  '400970': 'Unsupported field type for the requested operation.',
  '400971':
    'Unknown definition specification type. Use either basic_specification, abstract_query_specification, or viz_state_specification.',
  '400972': 'Time dimension must be absent when both range and comparison are unspecified.',
  '400000':
    'General validation error. Check that: version is 1, at least one metric is provided, all metric keys are unique and non-empty, and input counts are within limits.',
  '404936': 'Missing datasource ID or definition specification.',
};

export function formatPulseInsightsApiError(
  statusCode: number,
  responseData: unknown,
): { message: string; errorCode?: string; details: string } {
  const { errorCode, tabCode, guidance } = parseResponseData(responseData);

  const parts: string[] = [];
  parts.push(`Pulse Insights API returned HTTP ${statusCode}.`);
  if (errorCode) parts.push(`Error code: ${errorCode}.`);
  if (guidance) {
    parts.push(guidance);
  } else if (tabCode) {
    parts.push(`TabCode: ${tabCode}. Check the Pulse Insights API documentation for details.`);
  }

  return {
    message: parts.join(' '),
    errorCode: errorCode ?? undefined,
    details:
      typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData ?? ''),
  };
}

function parseResponseData(data: unknown): {
  errorCode: string | null;
  tabCode: string | null;
  guidance: string | null;
} {
  if (data == null || typeof data !== 'object') {
    return { errorCode: null, tabCode: null, guidance: null };
  }

  const obj = data as Record<string, unknown>;
  const errorCode = typeof obj.code === 'string' ? obj.code : null;
  const tabCode = typeof obj.message === 'string' ? obj.message : null;

  let guidance: string | null = null;
  if (errorCode && errorCode in PULSE_INSIGHTS_ERROR_GUIDANCE) {
    guidance = PULSE_INSIGHTS_ERROR_GUIDANCE[errorCode];
  }

  return { errorCode, tabCode, guidance };
}
