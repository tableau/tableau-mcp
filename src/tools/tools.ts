import { listDatasourcesTool } from './listDatasources/listDatasources.js';
import { listFieldsTool } from './listFields.js';
import { listAllPulseMetricDefinitionsTool } from './pulse/listMetricDefinitions/listAllPulseMetricDefinitions.js';
import { listPulseMetricDefinitionsFromDefinitionIdsTool } from './pulse/listMetricDefinitions/listPulseMetricDefinitionsFromDefinitionIds.js';
import { listPulseMetricsFromMetricDefinitionIdTool } from './pulse/listMetrics/listPulseMetricsFromMetricDefinitionId.js';
import { listPulseMetricsFromMetricIdsTool } from './pulse/listMetrics/listPulseMetricsFromMetricIds.js';
import { listPulseMetricSubscriptionsTool } from './pulse/listMetricSubscriptions/listPulseMetricSubscriptions.js';
import { queryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { readMetadataTool } from './readMetadata.js';

export const tools = [
  listDatasourcesTool,
  listFieldsTool,
  queryDatasourceTool,
  readMetadataTool,
  listAllPulseMetricDefinitionsTool,
  listPulseMetricDefinitionsFromDefinitionIdsTool,
  listPulseMetricsFromMetricDefinitionIdTool,
  listPulseMetricsFromMetricIdsTool,
  listPulseMetricSubscriptionsTool,
];
