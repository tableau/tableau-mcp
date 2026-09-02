import { getConfirmDeleteContentTool } from './_lib/confirmDeleteContent.js';
import { getDeleteContentTool } from './_lib/deleteContent.js';
import { getQueryAdminInsightsTool } from './adminInsights/queryAdminInsights.js';
import { getSearchContentTool } from './contentExploration/searchContent.js';
import { getListDatasourcesTool } from './datasources/listDatasources.js';
import { getConfirmUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/confirmUpdateCloudExtractRefreshTask.js';
import { getListExtractRefreshTasksTool } from './extractRefreshTasks/listExtractRefreshTasks.js';
import { getUpdateCloudExtractRefreshTaskTool } from './extractRefreshTasks/updateCloudExtractRefreshTask.js';
import { getGetFlowTool } from './flows/getFlow/getFlow.js';
import { getListFlowRunsTool } from './flows/listFlowRuns/listFlowRuns.js';
import { getListFlowsTool } from './flows/listFlows/listFlows.js';
import { getListFlowTasksTool } from './flows/listFlowTasks/listFlowTasks.js';
import { getGetDatasourceMetadataTool } from './getDatasourceMetadata/getDatasourceMetadata.js';
import { getEmbedTokenTool } from './getEmbedToken/getEmbedToken.js';
import { getListJobsTool } from './jobs/listJobs.js';
import { getCreateSemanticStatementsTool } from './knowledge/createSemanticStatements.js';
import { getDeleteSemanticStatementsTool } from './knowledge/deleteSemanticStatements.js';
import { getGetKnowledgeLineageTool } from './knowledge/getKnowledgeLineage.js';
import { getGetKnowledgeNodeTool } from './knowledge/getKnowledgeNode.js';
import { getGetKnowledgeNodeImpactTool } from './knowledge/getKnowledgeNodeImpact.js';
import { getGetKnowledgeNodeRelationshipsTool } from './knowledge/getKnowledgeNodeRelationships.js';
import { getGetKnowledgeSuggestionsTool } from './knowledge/getKnowledgeSuggestions.js';
import { getListKnowledgeSourcesTool } from './knowledge/listKnowledgeSources.js';
import { getListSemanticStatementsTool } from './knowledge/listSemanticStatements.js';
import { getSearchKnowledgeNodesTool } from './knowledge/searchKnowledgeNodes.js';
import { getUpdateSemanticStatementsTool } from './knowledge/updateSemanticStatements.js';
import { getListProjectsTool } from './projects/listProjects.js';
import { getGeneratePulseInsightBriefTool } from './pulse/generateInsightBrief/generatePulseInsightBriefTool.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './pulse/generateMetricValueInsightBundle/generatePulseMetricValueInsightBundleTool.js';
import { getGenerateInsightCardsTool } from './pulse/insights/generateInsightCardsTool.js';
import { getListAllPulseMetricDefinitionsTool } from './pulse/listAllMetricDefinitions/listAllPulseMetricDefinitions.js';
import { getListPulseMetricDefinitionsFromDefinitionIdsTool } from './pulse/listMetricDefinitionsFromDefinitionIds/listPulseMetricDefinitionsFromDefinitionIds.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './pulse/listMetricsFromMetricDefinitionId/listPulseMetricsFromMetricDefinitionId.js';
import { getListPulseMetricsFromMetricIdsTool } from './pulse/listMetricsFromMetricIds/listPulseMetricsFromMetricIds.js';
import { getListPulseMetricSubscriptionsTool } from './pulse/listMetricSubscriptions/listPulseMetricSubscriptions.js';
import { getQueryDatasourceTool } from './queryDatasource/queryDatasource.js';
import { getRecordEventTool } from './recordEvent/recordEvent.js';
import { getRenderInteractiveVizTool } from './renderInteractiveViz/renderInteractiveViz.js';
import { getResetConsentTool } from './resetConsent/resetConsent.js';
import { getRevokeAccessTokenTool } from './revokeAccessToken/revokeAccessToken.js';
import { getListUsersTool } from './users/listUsers.js';
import { getUpdateUserTool } from './users/updateUser.js';
import { getGetCustomViewDataTool } from './views/getCustomViewData.js';
import { getGetCustomViewImageTool } from './views/getCustomViewImage.js';
import { getGetViewTool } from './views/getView.js';
import { getGetViewDataTool } from './views/getViewData.js';
import { getGetViewImageTool } from './views/getViewImage.js';
import { getListCustomViewsTool } from './views/listCustomViews.js';
import { getListViewsTool } from './views/listViews.js';
import { getDownloadWorkbookTool } from './workbooks/downloadWorkbook.js';
import { getGetWorkbookTool } from './workbooks/getWorkbook.js';
import { getListWorkbooksTool } from './workbooks/listWorkbooks.js';
import { getPublishWorkbookTool } from './workbooks/publishWorkbook.js';
import { getRequestWorkbookUploadTool } from './workbooks/requestWorkbookUpload.js';

export const webToolFactories = [
  getGetDatasourceMetadataTool,
  getEmbedTokenTool,
  getRecordEventTool,
  getRenderInteractiveVizTool,
  getListDatasourcesTool,
  getListExtractRefreshTasksTool,
  getUpdateCloudExtractRefreshTaskTool,
  getConfirmUpdateCloudExtractRefreshTaskTool,
  getListJobsTool,
  getGetKnowledgeSuggestionsTool,
  getListKnowledgeSourcesTool,
  getSearchKnowledgeNodesTool,
  getGetKnowledgeNodeTool,
  getGetKnowledgeNodeRelationshipsTool,
  getGetKnowledgeLineageTool,
  getGetKnowledgeNodeImpactTool,
  getCreateSemanticStatementsTool,
  getListSemanticStatementsTool,
  getUpdateSemanticStatementsTool,
  getDeleteSemanticStatementsTool,
  getListUsersTool,
  getUpdateUserTool,
  getQueryDatasourceTool,
  getListFlowsTool,
  getGetFlowTool,
  getListFlowRunsTool,
  getListFlowTasksTool,
  getListAllPulseMetricDefinitionsTool,
  getListPulseMetricDefinitionsFromDefinitionIdsTool,
  getListPulseMetricsFromMetricDefinitionIdTool,
  getListPulseMetricsFromMetricIdsTool,
  getListPulseMetricSubscriptionsTool,
  getGeneratePulseMetricValueInsightBundleTool,
  getGeneratePulseInsightBriefTool,
  getGenerateInsightCardsTool,
  getDownloadWorkbookTool,
  getGetWorkbookTool,
  getRequestWorkbookUploadTool,
  getPublishWorkbookTool,
  getGetViewTool,
  getGetViewDataTool,
  getGetViewImageTool,
  getListWorkbooksTool,
  getListProjectsTool,
  getListViewsTool,
  getListCustomViewsTool,
  getGetCustomViewDataTool,
  getGetCustomViewImageTool,
  getSearchContentTool,
  getRevokeAccessTokenTool,
  getResetConsentTool,
  getQueryAdminInsightsTool,
  getDeleteContentTool,
  getConfirmDeleteContentTool,
];
