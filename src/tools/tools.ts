import { listDatasourcesTool } from './listDatasources/listDatasources.js';
import { listFieldsTool } from './listFields.js';
import { listAllPulseMetricDefinitionsTool } from './listPulseMetricDefinitions/listAllPulseMetricDefinitions.js';
import { listPulseMetricDefinitionsFromMetricDefinitionIdsTool } from './listPulseMetricDefinitions/listPulseMetricDefinitionsFromMetricDefinitionIds.js';
import { listPulseMetricsFromMetricDefinitionIdTool } from './listPulseMetrics/listPulseMetricsFromMetricDefinitionId.js';
import { listPulseMetricsFromMetricIdsTool } from './listPulseMetrics/listPulseMetricsFromMetricIds.js';
import { listPulseMetricSubscriptionsTool } from './listPulseMetricSubscriptions/listPulseMetricSubscriptions.js';
import { queryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { readMetadataTool } from './readMetadata.js';

export const tools = [
  listDatasourcesTool,
  listFieldsTool,
  queryDatasourceTool,
  readMetadataTool,
  listAllPulseMetricDefinitionsTool,
  listPulseMetricDefinitionsFromMetricDefinitionIdsTool,
  listPulseMetricsFromMetricDefinitionIdTool,
  listPulseMetricsFromMetricIdsTool,
  listPulseMetricSubscriptionsTool,
];
