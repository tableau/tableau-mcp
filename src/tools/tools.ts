import { getAdminGroupsTool } from './admin/groups/adminGroups.js';
import { getAdminUsersTool } from './admin/users/adminUsers.js';

export const toolFactories = [getAdminUsersTool, getAdminGroupsTool];
