const PULSE_INSIGHTS_ERROR_GUIDANCE: Record<string, string> = {
  // ── General ──────────────────────────────────────────────────────
  '400000':
    'General validation error. Check that: version is 1, at least one metric is provided, all metric keys are unique and non-empty, and input counts are within limits.',

  // ── Time / format validation (400700-series) ─────────────────────
  '400700': 'Invalid time format.',
  '400701': 'Invalid user LUID.',
  '400702': 'Invalid site LUID.',
  '400732':
    'Invalid measurement period. Check that the date format is YYYY-MM-DD and that start/end dates are valid.',
  '400733': 'Invalid order-by field.',
  '400734': 'Invalid order-by direction.',
  '400735': 'Invalid order-by format.',
  '400736': 'Invalid filter format.',
  '400737': 'Invalid filter operator.',
  '400738': 'Invalid filter date format.',
  '400739': 'Invalid dynamic offset configuration.',
  '400740': 'Invalid pagination token.',
  '400741': 'Prompt exceeds the token limit.',

  // ── Definition specification (400900-series) ─────────────────────
  '400900': 'Missing filter field name.',
  '400901':
    'Missing measure field. Ensure basic_specification.measure.field is a non-empty string.',
  '400902': 'Missing time dimension field. Ensure basic_specification.time_dimension.field is set.',
  '400903':
    'Invalid definition type. Use either basic_specification, abstract_query_specification, or viz_state_specification.',
  '400904': 'Missing abstract query definition.',
  '400905': 'Missing definition field.',
  '400906': 'User link exceeds character limit.',
  '400907': 'Invalid user link.',
  '400908': 'Metric model is missing required fields.',
  '400909': 'Metadata is missing required fields.',
  '400910': 'Invalid datasource ID.',
  '400911': 'Invalid field mask.',
  '400912': 'Missing core metric name.',
  '400913': 'Missing datasource.',
  '400914':
    'Invalid measure aggregation. Set basic_specification.measure.aggregation to a valid value (e.g., AGGREGATION_SUM, AGGREGATION_AVERAGE, AGGREGATION_USER).',
  '400915': 'Default metric cannot be deleted.',
  '400916': 'Exceeded maximum total scoped metrics for this definition.',
  '400917': 'Invalid filter value.',
  '400918': 'Invalid query input fields.',
  '400919': 'Invalid record-level identifier.',
  '400920': 'Invalid field value.',
  '400921': 'Unsupported aggregation function.',
  '400922': 'Invalid comparisons field.',
  '400923': 'Invalid scoped metric ID.',
  '400924': 'BigQuery connection error.',
  '400925': 'Datasource info retrieval error.',
  '400926': 'Incorrect data type.',
  '400927': 'Database general error.',
  '400928': 'Invalid formula.',
  '400929': 'Value too large.',
  '400930': 'Calculated field is already aggregated.',
  '400931': 'Context canceled.',
  '400932': 'Invalid definition ID.',
  '400933': 'Invalid abstract query specification.',
  '400934': 'Invalid parameters — over capacity.',
  '400935': 'Invalid viz state specification.',
  '400936': 'Invalid granularity value.',
  '400937': 'Exceeded maximum total ACL objects for definition.',
  '400938': 'Invalid argument for entitlements.',

  // ── Filters ──────────────────────────────────────────────────────
  '400940': 'Filter operator is missing or unspecified.',
  '400941':
    'Filter value is missing. Provide at least one value. Filters cannot mix string and boolean data types.',
  '400942': 'Abstract query output fields count error.',
  '400943': 'Viz state is missing a column.',
  '400944': 'Viz state is missing a row.',

  // ── Measurement period / comparison ──────────────────────────────
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

  // ── Bundle-specific ──────────────────────────────────────────────
  '400950': 'Invalid bundle type.',
  '400951': 'Invalid timezone.',
  '400952': 'Invalid date override.',
  '400953': 'Invalid GAI feedback.',
  '400954': 'Invalid GAI generation ID.',
  '400955': 'AI-powered insights (GAI) is not enabled for this site.',
  '400956': 'Invalid insight feedback.',
  '400957': 'Missing insight options.',

  // ── Field values ─────────────────────────────────────────────────
  '400958': 'Missing or incorrectly formatted field ID.',
  '400959': 'Invalid page size.',
  '400960': 'Field ID not set in the request.',
  '400961': 'Query parameters not valid.',
  '400962': 'Previous offset not valid.',
  '400963': 'Invalid page offset.',
  '400964': 'Invalid metric ID.',
  '400965': 'Invalid allowed dimensions.',
  '400966': 'VDS column not found.',
  '400967': 'Database configuration issue.',
  '400968': 'Invalid VDS abstract query argument.',

  // ── Constraint violations ────────────────────────────────────────
  '400969': 'Conflicting options: is_running_total cannot be true when is_summable is false.',
  '400970': 'Unsupported field type for the requested operation.',
  '400971':
    'Unknown definition specification type. Use either basic_specification, abstract_query_specification, or viz_state_specification.',
  '400972':
    'Invalid input metric. Time dimension must be absent when both range and comparison are unspecified.',
  '400973': 'Incompatible time dimension field role.',
  '400974': 'Incompatible time dimension data type.',
  '400975': 'Incompatible aggregation data type.',
  '400976': 'User has no subscriptions.',
  '400977': 'Invalid locale.',
  '400978': 'Invalid currency code.',
  '400979': 'Invalid record-level name data type.',
  '400980': 'Invalid record-level ID data type.',
  '400981': 'Record-level ID is empty.',
  '400982': 'Query canceled.',
  '400983': 'Missing representation options.',
  '400984': 'Missing datasource goal specification.',
  '400985': 'Unsupported datasource goal specification.',
  '400986': 'Unsupported aggregation for datasource goals.',
  '400987':
    'Missing basic specification. Ensure definition includes a basic_specification with measure and time_dimension.',
  '400988': 'Missing extension_options.',
  '400999': 'Pulse feature is disabled on this site.',

  // ── Authentication / authorization ───────────────────────────────
  '401002': 'Invalid authentication credentials.',
  '401003':
    'Datasource authentication failed. The datasource owner may need to re-authorize the OAuth connection in Tableau Cloud.',
  '403900': 'User lacks required site permissions.',
  '403901': 'User lacks permissions on this datasource.',
  '403902': 'Permission denied: cannot edit this definition.',
  '403903': 'Permission denied: cannot delete this definition.',
  '403904': 'Permission denied: cannot edit goals.',
  '403905':
    'User lacks the "define metrics" permission on this datasource. Contact the datasource owner.',
  '403906': 'Permission denied by entitlements.',
  '403907': 'Connection to EGPT is forbidden.',

  // ── Not found ────────────────────────────────────────────────────
  '404900': 'Core metric (definition) not found.',
  '404901': 'Scoped metric not found.',
  '404902': 'Measure aggregation not found.',
  '404903': 'Datasource semantic model not found.',
  '404904': 'Datasource field not found.',
  '404905': 'Field values not found.',
  '404906': 'Batch not found.',
  '404907': 'Site not found.',
  '404908': 'Datasource goal field not found.',
  '404931': 'Formula contains a table calculation, which is not supported.',
  '404932': 'Field does not exist.',
  '404933': 'Base column does not exist.',
  '404934': 'Unknown field.',
  '404935': 'Database table is missing.',
  '404936': 'Missing datasource ID or definition specification.',
  '404937': 'Record-level name field does not exist in the datasource.',
  '404938': 'Record-level ID field does not exist in the datasource.',
  '404939': 'Datasource is inaccessible.',
  '404950': 'API endpoint not found.',
  '404957': 'Summary not found.',
  '404958': 'Alert not found.',

  // ── Timeout ──────────────────────────────────────────────────────
  '408901': 'Request timed out (context deadline exceeded). Try again or simplify the request.',

  // ── Conflict / duplicate ─────────────────────────────────────────
  '409901': 'A scoped metric with the same definition already exists.',
  '409902':
    'A metric definition with the same specification already exists. Change the measure, aggregation, time dimension, or definition filters.',
  '409903': 'A metric with the same name already exists for this datasource.',
  '409904': 'Invalid viz state string.',
  '409905': 'Goals are not supported on this metric type.',
  '409906': 'Invalid offset_from_today value.',
  '409907': 'Duplicate tag.',
  '409908': 'Tag not found.',
  '409909': 'VDS conflict error.',

  // ── Rate limiting ────────────────────────────────────────────────
  '423900': 'Entitlements resource is locked.',
  '429900': 'Entitlements resource exhausted.',
  '429956': 'Summary generation was already attempted in the past 24 hours. Try again later.',
  '429957': 'VDS resource exhausted. Try again later.',

  // ── Server errors ────────────────────────────────────────────────
  '500000': 'Internal service error.',
  '500900': 'Internal service error (retryable). Try the request again.',
  '503900': 'Entitlements service is unavailable. Try again later.',
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
