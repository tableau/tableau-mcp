import { z } from 'zod';

/**
 * User schema for Tableau REST API
 * Extended for admin use cases to include full user profile information
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site
 */
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteRole: z.string().optional(),
  email: z.string().optional(),
  fullName: z.string().optional(),
  lastLogin: z.string().optional(),
  authSetting: z.string().optional(),
  locale: z.string().optional(),
  language: z.string().optional(),
  externalAuthUserId: z.string().optional(),
});

export type User = z.infer<typeof userSchema>;

export const ADMIN_SITE_ROLES = new Set([
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'ServerAdministrator',
]);

export function isAdminSiteRole(siteRole: string | undefined): boolean {
  if (!siteRole) {
    return false;
  }
  return ADMIN_SITE_ROLES.has(siteRole);
}
