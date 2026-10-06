import { DOMParser } from '@xmldom/xmldom';

import {
  composeDashboardWorkbook,
  dashboardMembershipMatches,
  dashboardWorksheetNames,
  omitWorkbookActions,
  synchronizeDashboardViewpoints,
} from './dashboardViewpoints.js';

describe('dashboard viewpoint registration', () => {
  it('leaves malformed fragments to the validation funnel', () => {
    expect(dashboardWorksheetNames('<dashboard name="D"><zone')).toEqual([]);
  });
  it('preserves interleaved worksheet XML and the dashboard identity during composition', () => {
    const worksheet =
      '<worksheet name="A"><style><format value="1"/><encoding attr="x"/><format value="2"/></style></worksheet>';
    const source = `<workbook><worksheets>${worksheet}</worksheets><dashboards><dashboard name="D"><simple-id uuid="stable"/></dashboard><dashboard name="Other"/></dashboards></workbook>`;
    const result = composeDashboardWorkbook(
      source,
      'D',
      '<dashboard name="D"><zones><zone name="A"/></zones></dashboard>',
    );
    expect(result).toContain(worksheet);
    expect(result).toContain('<simple-id uuid="stable"/>');
    expect(result).toContain('<dashboard name="Other"/>');
    expect(dashboardMembershipMatches(result, 'D', ['A'])).toBe(true);
  });
  it('omits existing root actions from dashboard-only posts without removing other content', () => {
    const source =
      '<workbook><actions><action name="Existing"/></actions><worksheets><worksheet name="A"/></worksheets><dashboards><dashboard name="D"/></dashboards></workbook>';
    const posted = omitWorkbookActions(source);
    expect(posted).not.toContain('<actions');
    expect(posted).toContain('<worksheet name="A"/>');
    expect(posted).toContain('<dashboard name="D"/>');
  });
  it('collects nested and device-only worksheets once, excluding objects', () => {
    expect(
      dashboardWorksheetNames(`<dashboard name="D"><zones>
      <zone type-v2="layout-flow"><zone name="A &amp; B" /><zone name="Legend" type-v2="text" /></zone>
      </zones><devicelayouts><devicelayout><zones><zone name="A &amp; B" />
      <zone name="Phone" type-v2="visual" /></zones></devicelayout></devicelayouts></dashboard>`),
    ).toEqual(['A & B', 'Phone']);
  });

  it('preserves retained viewpoint settings and unrelated windows while adding and removing members', () => {
    const source = `<workbook><windows><window class="worksheet" name="Other"><cards /></window>
      <window class="dashboard" name="D"><active id="3" /><viewpoints>
      <viewpoint name="Keep"><zoom type="standard" /><highlight field="x" /></viewpoint>
      <viewpoint name="Remove" /></viewpoints><viewpoints><viewpoint name="Keep" /></viewpoints>
      </window></windows></workbook>`;
    const result = synchronizeDashboardViewpoints(source, 'D', ['Keep', 'Add']);
    expect(result.changed).toBe(true);
    const doc = new DOMParser().parseFromString(result.xml, 'text/xml');
    const window = doc.getElementsByTagName('window')[1];
    expect(window.firstChild?.nodeName).toBe('viewpoints');
    expect(window.getElementsByTagName('viewpoints').length).toBe(1);
    expect(
      Array.from(window.getElementsByTagName('viewpoint')).map((vp) => vp.getAttribute('name')),
    ).toEqual(['Keep', 'Add']);
    expect(result.xml).toContain('<zoom type="standard"/><highlight field="x"/>');
    expect(result.xml).toContain('<window class="worksheet" name="Other"><cards/></window>');
    expect(result.xml).toContain('<active id="3"/>');
    expect(synchronizeDashboardViewpoints(result.xml, 'D', ['Add', 'Keep'])).toEqual({
      xml: result.xml,
      changed: false,
    });
  });

  it('creates a missing window and removes the final worksheet registration', () => {
    const added = synchronizeDashboardViewpoints('<workbook/>', 'D & E', ['Sheet']);
    expect(added.xml).toContain('name="D &amp; E"');
    const removed = synchronizeDashboardViewpoints(added.xml, 'D & E', []);
    expect(removed.changed).toBe(true);
    expect(removed.xml).toContain('<viewpoints/>');
    expect(removed.xml).not.toContain('<viewpoint ');
  });

  it('requires both live zones and registrations for verification', () => {
    const source =
      '<workbook><dashboards><dashboard name="D"><zones><zone name="A"/></zones></dashboard></dashboards></workbook>';
    expect(dashboardMembershipMatches(source, 'D', ['A'])).toBe(false);
    const registered = synchronizeDashboardViewpoints(source, 'D', ['A']).xml;
    expect(dashboardMembershipMatches(registered, 'D', ['A'])).toBe(true);
    const retained = registered.replace('<viewpoints>', '<viewpoints><viewpoint name="Removed"/>');
    expect(dashboardMembershipMatches(retained, 'D', ['A'])).toBe(true);
    expect(dashboardMembershipMatches(registered, 'D', ['B'])).toBe(false);
    expect(dashboardMembershipMatches(registered, 'Missing', [])).toBe(false);
  });
});
