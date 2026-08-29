import { isAdminSiteRole, MIN_ADMIN_SITE_ROLE, siteRoleMeetsMinimum } from './user.js';

describe('siteRoleMeetsMinimum', () => {
  it('returns true when the role outranks the minimum', () => {
    expect(siteRoleMeetsMinimum('ServerAdministrator', 'SiteAdministratorExplorer')).toBe(true);
  });

  it('returns true when the role exactly matches the minimum', () => {
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', 'SiteAdministratorExplorer')).toBe(
      true,
    );
  });

  it('returns false when the role ranks below the minimum', () => {
    expect(siteRoleMeetsMinimum('Creator', 'SiteAdministratorExplorer')).toBe(false);
    expect(siteRoleMeetsMinimum('Viewer', 'SiteAdministratorExplorer')).toBe(false);
  });

  it('orders admin roles above non-admin roles', () => {
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', 'Creator')).toBe(true);
  });

  it('orders the non-admin content roles by publishing capability', () => {
    expect(siteRoleMeetsMinimum('Creator', 'Viewer')).toBe(true);
    expect(siteRoleMeetsMinimum('ExplorerCanPublish', 'Explorer')).toBe(true);
    expect(siteRoleMeetsMinimum('Viewer', 'Explorer')).toBe(false);
  });

  it('fails closed for an undefined role', () => {
    expect(siteRoleMeetsMinimum(undefined, 'SiteAdministratorExplorer')).toBe(false);
  });

  it('fails closed for an empty role', () => {
    expect(siteRoleMeetsMinimum('', 'SiteAdministratorExplorer')).toBe(false);
  });

  it('fails closed for an unrecognized role', () => {
    expect(siteRoleMeetsMinimum('GuestUser', 'Viewer')).toBe(false);
  });

  it('ranks SupportUser just below SiteAdministratorExplorer and above Creator', () => {
    expect(siteRoleMeetsMinimum('SupportUser', 'Creator')).toBe(true);
    expect(siteRoleMeetsMinimum('SupportUser', 'SiteAdministratorExplorer')).toBe(false);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', 'SupportUser')).toBe(true);
  });

  it('uses SupportUser as the admin threshold', () => {
    expect(MIN_ADMIN_SITE_ROLE).toBe('SupportUser');
    expect(siteRoleMeetsMinimum('SupportUser', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorExplorer', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('SiteAdministratorCreator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('ServerAdministrator', MIN_ADMIN_SITE_ROLE)).toBe(true);
    expect(siteRoleMeetsMinimum('Creator', MIN_ADMIN_SITE_ROLE)).toBe(false);
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
