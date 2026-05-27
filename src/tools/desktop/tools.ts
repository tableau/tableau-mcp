import { getCheckForUserChangesTool } from './session/checkForUserChanges.js';
import { getListInstancesTool } from './session/listInstances.js';
import { getGetWorkbookXmlTool } from './workbook/getWorkbookXml.js';

export const desktopToolFactories = [
  getListInstancesTool,
  getCheckForUserChangesTool,
  getGetWorkbookXmlTool,
];
