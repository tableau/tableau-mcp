import { getContentProjectsTool } from './admin/content/contentProjects.js';
import { getContentViewsTool } from './admin/content/contentViews.js';
import { getContentWorkbooksTool } from './admin/content/contentWorkbooks.js';
import { getAdminGroupsTool } from './admin/groups/adminGroups.js';
import { getSiteJobsTool } from './admin/jobs/siteJobs.js';
import { getTableauOperationsTool } from './admin/operations/tableauOperations.js';
import { getContentPermissionsTool } from './admin/permissions/contentPermissions.js';
import { getAdminUsersTool } from './admin/users/adminUsers.js';

export const toolFactories = [
  getAdminUsersTool,
  getAdminGroupsTool,
  getContentPermissionsTool,
  getContentProjectsTool,
  getContentWorkbooksTool,
  getContentViewsTool,
  getSiteJobsTool,
  getTableauOperationsTool,
];
