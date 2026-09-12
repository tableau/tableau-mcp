import {
  isAdminSiteRole,
  MIN_ADMIN_SITE_ROLE,
  roleRequiresEnforcement,
  SiteRole,
  siteRoleMeetsMinimum,
} from './user.js';

describe('siteRoleMeetsMinimum', () => {
  it('returns true when the role outranks the minimum', () => {
    expect(siteRoleMeetsMinimum('ServerAdministrator', SiteRole.SiteAdministratorExplorer)).toBe(
      true,
    );
  });

  it('returns true when the role exactly matches the minimum', () => {
    expect(
      siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.SiteAdministratorExplorer),
    ).toBe(true);
  });

  it('returns false when the role ranks below the minimum', () => {
    expect(siteRoleMeetsMinimum('Creator', SiteRole.SiteAdministratorExplorer)).toBe(false);
    expect(siteRoleMeetsMinimum('Viewer', SiteRole.SiteAdministratorExplorer)).toBe(false);
  });

  it('orders admin roles above non-admin roles', () => {
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.Creator)).toBe(true);
  });

  it('orders the non-admin content roles by publishing capability', () => {
    expect(siteRoleMeetsMinimum('Creator', SiteRole.Viewer)).toBe(true);
    expect(siteRoleMeetsMinimum('ExplorerCanPublish', SiteRole.Explorer)).toBe(true);
    expect(siteRoleMeetsMinimum('Viewer', SiteRole.Explorer)).toBe(false);
  });

  it('fails closed for an undefined role', () => {
    expect(siteRoleMeetsMinimum(undefined, SiteRole.SiteAdministratorExplorer)).toBe(false);
  });

  it('fails closed for an empty role', () => {
    expect(siteRoleMeetsMinimum('', SiteRole.SiteAdministratorExplorer)).toBe(false);
  });

  it('fails closed for an unrecognized role', () => {
    expect(siteRoleMeetsMinimum('GuestUser', SiteRole.Viewer)).toBe(false);
  });

  it('ranks SupportUser just below SiteAdministratorExplorer and above Creator', () => {
    expect(siteRoleMeetsMinimum('SupportUser', SiteRole.Creator)).toBe(true);
    expect(siteRoleMeetsMinimum('SupportUser', SiteRole.SiteAdministratorExplorer)).toBe(false);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', SiteRole.SupportUser)).toBe(true);
  });

  it('uses SupportUser as the admin threshold', () => {
    expect(MIN_ADMIN_SITE_ROLE).toBe(SiteRole.SupportUser);
    expect(siteRoleMeetsMinimum('SupportUser', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorCreator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('ServerAdministrator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('Creator', MIN_ADMIN_SITE_ROLE)).toBe(false);
  });
});

describe('roleRequiresEnforcement', () => {
  it('does not enforce a Viewer minimum (every authenticated caller satisfies it)', () => {
    expect(roleRequiresEnforcement(SiteRole.Viewer)).toBe(false);
  });

  it('does not enforce a minimum below Viewer', () => {
    expect(roleRequiresEnforcement(SiteRole.Unlicensed)).toBe(false);
  });

  it('enforces every minimum ranked above Viewer', () => {
    expect(roleRequiresEnforcement(SiteRole.Explorer)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.ExplorerCanPublish)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.Creator)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SupportUser)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SiteAdministratorExplorer)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.SiteAdministratorCreator)).toBe(true);
    expect(roleRequiresEnforcement(SiteRole.ServerAdministrator)).toBe(true);
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
