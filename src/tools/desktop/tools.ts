import { getCheckForUserChangesTool } from './session/checkForUserChanges.js';
import { getListInstancesTool } from './session/listInstances.js';

export const desktopToolFactories = [getListInstancesTool, getCheckForUserChangesTool];
