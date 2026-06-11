import { getApplyDashboardTool } from './dashboard/applyDashboard.js';
import { getApplyDashboardWithViewpointsTool } from './dashboard/applyDashboardWithViewpoints.js';
import { getBuildAndApplyDashboardTool } from './dashboard/buildAndApplyDashboard.js';
import { getGetDashboardXmlTool } from './dashboard/getDashboardXml.js';
import { getCheckForUserChangesTool } from './session/checkForUserChanges.js';
import { getListInstancesTool } from './session/listInstances.js';
import { getApplyWorkbookTool } from './workbook/applyWorkbook.js';
import { getGetWorkbookXmlTool } from './workbook/getWorkbookXml.js';
import { getListDashboardsTool } from './workbook/listDashboards.js';
import { getListWorksheetsTool } from './workbook/listWorksheets.js';
import { getApplyWorksheetTool } from './worksheet/applyWorksheet.js';
import { getGetWorksheetXmlTool } from './worksheet/getWorksheetXml.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getCheckForUserChangesTool,
  getGetWorkbookXmlTool,
  getApplyWorkbookTool,
  getListWorksheetsTool,
  getListDashboardsTool,
  getGetWorksheetXmlTool,
  getApplyWorksheetTool,
  getGetDashboardXmlTool,
  getApplyDashboardTool,
  getApplyDashboardWithViewpointsTool,
  getBuildAndApplyDashboardTool,
];
