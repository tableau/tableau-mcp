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

export const ADMIN_SITE_ROLES: readonly string[] = [
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'ServerAdministrator',
];

export function isAdminSiteRole(siteRole: string | undefined): boolean {
  if (!siteRole) {
    return false;
  }
  return ADMIN_SITE_ROLES.includes(siteRole);
}

/**
 * Tableau site roles ordered by privilege, lowest → highest. The numeric rank lets a tool gate
 * on the *minimum* role it requires (see `minRequiredRole`): a caller qualifies when their role's
 * rank is >= the tool's minimum, so a tool only names the lowest acceptable role rather than
 * enumerating every role above it. Ordering follows Tableau's documented site-role capability
 * ladder (admin roles above the content roles; content roles by publishing capability).
 * @see https://help.tableau.com/current/server/en-us/users_site_roles.htm
 */
export const SITE_ROLE_HIERARCHY = {
  Unlicensed: 0,
  Viewer: 1,
  Explorer: 2,
  ExplorerCanPublish: 3,
  Creator: 4,
  SupportUser: 5,
  SiteAdministratorExplorer: 6,
  SiteAdministratorCreator: 7,
  ServerAdministrator: 8,
} as const satisfies Record<string, number>;

export type SiteRole = keyof typeof SITE_ROLE_HIERARCHY;

/** The lowest site role permitted to register the admin/site-health tools. */
export const MIN_ADMIN_SITE_ROLE: SiteRole = 'SupportUser';

/**
 * True when `siteRole` ranks at or above `minRole` in {@link SITE_ROLE_HIERARCHY}. Fail-closed:
 * an undefined, empty, or unrecognized `siteRole` never meets the minimum.
 */
export function siteRoleMeetsMinimum(siteRole: string | undefined, minRole: SiteRole): boolean {
  if (!siteRole || !(siteRole in SITE_ROLE_HIERARCHY)) {
    return false;
  }
  return SITE_ROLE_HIERARCHY[siteRole as SiteRole] >= SITE_ROLE_HIERARCHY[minRole];
}
