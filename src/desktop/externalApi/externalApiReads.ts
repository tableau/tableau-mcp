import { Result } from 'ts-results-es';

import { ExecuteCommandError, ToolExecutor } from '../toolExecutor/toolExecutor.js';
import { WorkbookDocument } from './externalApiClient.js';
import {
  DashboardItem,
  DashboardList,
  DatasourceList,
  Site,
  SiteDatasourceList,
  SiteWorkbookList,
  StoryboardItem,
  StoryboardList,
  SummaryData,
  ValidationResult,
  WorkbookInventory,
  WorksheetItem,
  WorksheetList,
} from './types.js';

type ExternalRead<T> = Result<T, ExecuteCommandError>;

/**
 * The Tableau Desktop External Client API's endpoints as first-class typed calls. These are HTTP
 * endpoints, not Agent-API commands — deliberately kept off `executeCommand`'s `tabui`/`tabdoc`
 * command surface.
 */
export interface ExternalApiReads {
  getWorkbookDocument(signal: AbortSignal): Promise<ExternalRead<WorkbookDocument>>;
  applyWorkbookDocument(xml: string, signal: AbortSignal): Promise<ExternalRead<void>>;

  listWorksheets(signal: AbortSignal): Promise<ExternalRead<WorksheetList>>;
  getWorksheet(id: string, signal: AbortSignal): Promise<ExternalRead<WorksheetItem>>;
  getWorksheetDocument(id: string, signal: AbortSignal): Promise<ExternalRead<WorkbookDocument>>;
  getWorksheetSummaryData(
    id: string,
    options: { maxRows?: number },
    signal: AbortSignal,
  ): Promise<ExternalRead<SummaryData>>;

  listDashboards(signal: AbortSignal): Promise<ExternalRead<DashboardList>>;
  getDashboard(id: string, signal: AbortSignal): Promise<ExternalRead<DashboardItem>>;
  getDashboardDocument(id: string, signal: AbortSignal): Promise<ExternalRead<WorkbookDocument>>;

  listStoryboards(signal: AbortSignal): Promise<ExternalRead<StoryboardList>>;
  getStoryboard(id: string, signal: AbortSignal): Promise<ExternalRead<StoryboardItem>>;
  getStoryboardDocument(id: string, signal: AbortSignal): Promise<ExternalRead<WorkbookDocument>>;

  getWorkbookInventory(signal: AbortSignal): Promise<ExternalRead<WorkbookInventory>>;
  listWorkbookDatasources(signal: AbortSignal): Promise<ExternalRead<DatasourceList>>;

  getSite(signal: AbortSignal): Promise<ExternalRead<Site>>;
  listSiteDatasources(signal: AbortSignal): Promise<ExternalRead<SiteDatasourceList>>;
  listSiteWorkbooks(signal: AbortSignal): Promise<ExternalRead<SiteWorkbookList>>;

  validateWorkbookDocument(
    xml: string,
    signal: AbortSignal,
  ): Promise<ExternalRead<ValidationResult>>;
}

function isExternalApiReads(executor: ToolExecutor): executor is ToolExecutor & ExternalApiReads {
  return typeof (executor as Partial<ExternalApiReads>).getWorkbookDocument === 'function';
}

/** Narrow a {@link ToolExecutor} to its External Client API endpoint surface; throws if the
 * executor is not the External transport (the Agent transport has no such endpoints). */
export function externalApiReads(executor: ToolExecutor): ExternalApiReads {
  if (!isExternalApiReads(executor)) {
    throw new Error(
      'externalApiReads called on a non-External executor — External Client API endpoints are ' +
        'only available when TABLEAU_EXTERNAL_API is enabled.',
    );
  }
  return executor;
}
