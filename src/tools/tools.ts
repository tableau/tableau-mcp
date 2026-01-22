import { getAddAssumptionTool } from './analysisSession/addAssumption.js';
import { getAddFactTool } from './analysisSession/addFact.js';
import { getCreateAnalysisSessionTool } from './analysisSession/createAnalysisSession.js';
import { getDeleteAnalysisSessionTool } from './analysisSession/deleteAnalysisSession.js';
import { getGetAnalysisSessionTool } from './analysisSession/getAnalysisSession.js';
import { getImportWorkbookFactsTool } from './analysisSession/importWorkbookFacts.js';
import { getSummarizeSessionTool } from './analysisSession/summarizeSession.js';
import { getUpdateHypothesisTool } from './analysisSession/updateHypothesis.js';
import { getSearchContentTool } from './contentExploration/searchContent.js';
import { getGetDatasourceMetadataTool } from './getDatasourceMetadata/getDatasourceMetadata.js';
import { getListDatasourcesTool } from './listDatasources/listDatasources.js';
import { getGeneratePulseInsightBriefTool } from './pulse/generateInsightBrief/generatePulseInsightBriefTool.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './pulse/generateMetricValueInsightBundle/generatePulseMetricValueInsightBundleTool.js';
import { getListAllPulseMetricDefinitionsTool } from './pulse/listAllMetricDefinitions/listAllPulseMetricDefinitions.js';
import { getListPulseMetricDefinitionsFromDefinitionIdsTool } from './pulse/listMetricDefinitionsFromDefinitionIds/listPulseMetricDefinitionsFromDefinitionIds.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './pulse/listMetricsFromMetricDefinitionId/listPulseMetricsFromMetricDefinitionId.js';
import { getListPulseMetricsFromMetricIdsTool } from './pulse/listMetricsFromMetricIds/listPulseMetricsFromMetricIds.js';
import { getListPulseMetricSubscriptionsTool } from './pulse/listMetricSubscriptions/listPulseMetricSubscriptions.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getGetViewDataTool } from './views/getViewData.js';
import { getGetViewImageTool } from './views/getViewImage.js';
import { getListViewsTool } from './views/listViews.js';
import { getGetWorkbookTool } from './workbooks/getWorkbook.js';
import { getListWorkbooksTool } from './workbooks/listWorkbooks.js';

export const toolFactories = [
  getGetDatasourceMetadataTool,
  getListDatasourcesTool,
  getQueryDatasourceTool,
  getListAllPulseMetricDefinitionsTool,
  getListPulseMetricDefinitionsFromDefinitionIdsTool,
  getListPulseMetricsFromMetricDefinitionIdTool,
  getListPulseMetricsFromMetricIdsTool,
  getListPulseMetricSubscriptionsTool,
  getGeneratePulseMetricValueInsightBundleTool,
  getGeneratePulseInsightBriefTool,
  getGetWorkbookTool,
  getGetViewDataTool,
  getGetViewImageTool,
  getListWorkbooksTool,
  getListViewsTool,
  getSearchContentTool,
  // Analysis Session tools
  getCreateAnalysisSessionTool,
  getGetAnalysisSessionTool,
  getDeleteAnalysisSessionTool,
  getUpdateHypothesisTool,
  getAddFactTool,
  getAddAssumptionTool,
  getImportWorkbookFactsTool,
  getSummarizeSessionTool,
];
