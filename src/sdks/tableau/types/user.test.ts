import {
  isAdminSiteRole,
  MIN_ADMIN_SITE_ROLE,
  roleRequiresEnforcement,
  SiteRole,
  siteRoleMeetsMinimum,
} from './user.js';

describe('siteRoleMeetsMinimum', () => {
  it('returns true when the role outranks the minimum', () => {
    expect(siteRoleMeetsMinimum('ServerAdministrator', SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(
      true,
    );
  });

  it('returns true when the role exactly matches the minimum', () => {
    expect(
      siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.SITE_ADMINISTRATOR_EXPLORER),
    ).toBe(true);
  });

  it('returns false when the role ranks below the minimum', () => {
    expect(siteRoleMeetsMinimum('Creator', SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(false);
    expect(siteRoleMeetsMinimum('Viewer', SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(false);
  });

  it('orders admin roles above non-admin roles', () => {
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.CREATOR)).toBe(true);
  });

  it('orders the non-admin content roles by publishing capability', () => {
    expect(siteRoleMeetsMinimum('Creator', SiteRole.VIEWER)).toBe(true);
    expect(siteRoleMeetsMinimum('ExplorerCanPublish', SiteRole.EXPLORER)).toBe(true);
    expect(siteRoleMeetsMinimum('Viewer', SiteRole.EXPLORER)).toBe(false);
  });

  it('fails closed for an undefined role', () => {
    expect(siteRoleMeetsMinimum(undefined, SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(false);
  });

  it('fails closed for an empty role', () => {
    expect(siteRoleMeetsMinimum('', SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(false);
  });

  it('fails closed for an unrecognized role', () => {
    expect(siteRoleMeetsMinimum('GuestUser', SiteRole.VIEWER)).toBe(false);
  });

  it('ranks SupportUser just below SiteAdministratorExplorer and above Creator', () => {
    expect(siteRoleMeetsMinimum('SupportUser', SiteRole.CREATOR)).toBe(true);
    expect(siteRoleMeetsMinimum('SupportUser', SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(false);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.SUPPORT_USER)).toBe(true);
  });

  it('uses SupportUser as the admin threshold', () => {
    expect(MIN_ADMIN_SITE_ROLE).toBe(SiteRole.SUPPORT_USER);
    expect(siteRoleMeetsMinimum('SupportUser', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorCreator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('ServerAdministrator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('Creator', MIN_ADMIN_SITE_ROLE)).toBe(false);
  });
});

describe('roleRequiresEnforcement', () => {
  it('does not enforce a Viewer minimum (every authenticated caller satisfies it)', () => {
    expect(roleRequiresEnforcement(SiteRole.VIEWER)).toBe(false);
  });

  it('enforces every minimum ranked above Viewer', () => {
    expect(roleRequiresEnforcement(SiteRole.EXPLORER)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.EXPLORER_CAN_PUBLISH)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.CREATOR)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SUPPORT_USER)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SITE_ADMINISTRATOR_EXPLORER)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SITE_ADMINISTRATOR_CREATOR)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SERVER_ADMINISTRATOR)).toBe(true);
  });
});

describe('isAdminSiteRole', () => {
  it('treats SupportUser as an admin role (execution gate)', () => {
    expect(isAdminSiteRole('SupportUser')).toBe(true);
  });

  it('treats the site/server administrator roles as admin', () => {
    expect(isAdminSiteRole('SiteAdministratorExplorer')).toBe(true);
    expect(isAdminSiteRole('SiteAdministratorCreator')).toBe(true);
    expect(isAdminSiteRole('ServerAdministrator')).toBe(true);
  });

  it('treats content roles as non-admin', () => {
    expect(isAdminSiteRole('Creator')).toBe(false);
    expect(isAdminSiteRole('ExplorerCanPublish')).toBe(false);
    expect(isAdminSiteRole('Viewer')).toBe(false);
  });

  it('fails closed for undefined, empty, or unrecognized roles', () => {
    expect(isAdminSiteRole(undefined)).toBe(false);
    expect(isAdminSiteRole('')).toBe(false);
    expect(isAdminSiteRole('GuestUser')).toBe(false);
  });
});
