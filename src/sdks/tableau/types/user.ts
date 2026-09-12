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

/**
 * Tableau site roles, modeled as a string enum so callers reference `SiteRole.Viewer` rather than
 * repeating the raw string. The enum's string *values* deliberately equal the site-role strings the
 * Tableau REST API returns, so a raw API role compares directly against {@link SITE_ROLE_HIERARCHY}.
 * @see https://help.tableau.com/current/server/en-us/users_site_roles.htm
 */
export enum SiteRole {
  Unlicensed = 'Unlicensed',
  Viewer = 'Viewer',
  Explorer = 'Explorer',
  ExplorerCanPublish = 'ExplorerCanPublish',
  Creator = 'Creator',
  SupportUser = 'SupportUser',
  SiteAdministratorExplorer = 'SiteAdministratorExplorer',
  SiteAdministratorCreator = 'SiteAdministratorCreator',
  ServerAdministrator = 'ServerAdministrator',
}

export const ADMIN_SITE_ROLES: readonly string[] = [
  SiteRole.SupportUser,
  SiteRole.SiteAdministratorCreator,
  SiteRole.SiteAdministratorExplorer,
  SiteRole.ServerAdministrator,
];

export function isAdminSiteRole(siteRole: string | undefined): boolean {
  if (!siteRole) {
    return false;
  }
  return ADMIN_SITE_ROLES.includes(siteRole);
}

/**
 * The numeric rank of each {@link SiteRole}, lowest → highest. The rank lets a tool gate on the
 * *minimum* role it requires (see `minRequiredRole`): a caller qualifies when their role's rank is
 * >= the tool's minimum, so a tool only names the lowest acceptable role rather than enumerating
 * every role above it. Ordering follows Tableau's documented site-role capability ladder (admin
 * roles above the content roles; content roles by publishing capability).
 */
export const SITE_ROLE_HIERARCHY = {
  [SiteRole.Unlicensed]: 0,
  [SiteRole.Viewer]: 1,
  [SiteRole.Explorer]: 2,
  [SiteRole.ExplorerCanPublish]: 3,
  [SiteRole.Creator]: 4,
  [SiteRole.SupportUser]: 5,
  [SiteRole.SiteAdministratorExplorer]: 6,
  [SiteRole.SiteAdministratorCreator]: 7,
  [SiteRole.ServerAdministrator]: 8,
} as const satisfies Record<SiteRole, number>;

/** The lowest site role permitted to register the admin/site-health tools. */
export const MIN_ADMIN_SITE_ROLE: SiteRole = SiteRole.SupportUser;

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

/**
 * Whether a tool's `minRequiredRole` is high enough to be worth enforcing at registration time.
 * A minimum of {@link SiteRole.Viewer} (or lower) is satisfied by every authenticated caller, so
 * such tools are never gated — enforcement applies only when the minimum ranks *above* Viewer.
 */
export function roleRequiresEnforcement(minRole: SiteRole): boolean {
  return SITE_ROLE_HIERARCHY[minRole] > SITE_ROLE_HIERARCHY[SiteRole.Viewer];
}
