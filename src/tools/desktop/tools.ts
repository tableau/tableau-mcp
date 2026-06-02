import { getCheckForUserChangesTool } from './session/checkForUserChanges.js';
import { getListInstancesTool } from './session/listInstances.js';
import { getApplyWorkbookTool } from './workbook/applyWorkbook.js';
import { getGetWorkbookXmlTool } from './workbook/getWorkbookXml.js';
import { getListWorksheetsTool } from './workbook/listWorksheets.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getCheckForUserChangesTool,
  getGetWorkbookXmlTool,
  getApplyWorkbookTool,
  getListWorksheetsTool,
];
