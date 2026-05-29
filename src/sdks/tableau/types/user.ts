import { z } from 'zod';

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  siteRole: z.string().optional(),
  email: z.string().optional(),
  fullName: z.string().optional(),
  lastLogin: z.string().optional(),
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
