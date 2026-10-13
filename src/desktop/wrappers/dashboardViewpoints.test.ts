import { DOMParser } from '@xmldom/xmldom';

import {
  composeDashboardWorkbook,
  createDashboardReadbackVerifier,
  dashboardMembershipMatches,
  dashboardWorksheetNames,
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
    ).unwrap().xml;
    expect(result).toContain(worksheet);
    expect(result).toContain('<simple-id uuid="stable"/>');
    expect(result).toContain('<dashboard name="Other"/>');
    expect(dashboardMembershipMatches(result, 'D', ['A'])).toBe(true);
  });

  it('rejects newly introduced missing worksheet references, including device-only visual zones', () => {
    const result = composeDashboardWorkbook(
      '<workbook><worksheets><worksheet name="A"/></worksheets></workbook>',
      'D',
      '<dashboard name="D"><zones><zone name="A"/></zones><devicelayouts><devicelayout name="Phone"><zones><zone name="Missing" type-v2="visual"/></zones></devicelayout></devicelayouts></dashboard>',
    );
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toMatchObject([
      {
        ruleId: 'dashboard-zones-reference-included-worksheets',
        message: expect.stringContaining('Missing'),
      },
    ]);
  });

  it('leaves pre-existing unrelated dashboard defects unchanged', () => {
    const unrelated = '<dashboard name="Other"><zones><zone name="Missing"/></zones></dashboard>';
    const source = `<workbook><worksheets><worksheet name="A"/></worksheets><dashboards>${unrelated}</dashboards></workbook>`;
    const result = composeDashboardWorkbook(
      source,
      'D',
      '<dashboard name="D"><zones><zone name="A"/></zones></dashboard>',
    ).unwrap();
    expect(result.xml).toContain(unrelated);
    expect(result.worksheetNames).toEqual(['A']);
    expect(dashboardMembershipMatches(result.xml, 'D', ['A'])).toBe(true);
  });

  it.each([
    '<dashboards><dashboard name="D"/><dashboard name="D"/></dashboards>',
    '<windows><window class="dashboard" name="D"/><window class="dashboard" name="D"/></windows>',
  ])('rejects ambiguous target identity before composing: %s', (ambiguous) => {
    const result = composeDashboardWorkbook(
      `<workbook>${ambiguous}</workbook>`,
      'D',
      '<dashboard name="D"><zones/></dashboard>',
    );
    expect(result.unwrapErr()).toMatchObject([{ ruleId: 'dashboard-membership-identity' }]);
  });

  it('matches decoded and canonically equivalent worksheet names', () => {
    const result = composeDashboardWorkbook(
      '<workbook><worksheets><worksheet name="A &amp; Café"/></worksheets></workbook>',
      'D',
      '<dashboard name="D"><zones><zone name="A &amp; Café"/></zones></dashboard>',
    ).unwrap();
    expect(dashboardMembershipMatches(result.xml, 'D', ['A & Café'])).toBe(true);
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

describe('dashboard content readback', () => {
  const dashboard = `<dashboard name="D"><size minwidth="1000" minheight="800"/>
    <zones><zone id="1" type-v2="layout-basic"><zone id="2" name="A" x="100" y="200" w="300" h="400">
    <zone-style><format attr="margin" value="4"/></zone-style></zone>
    <zone id="3" type-v2="text"><formatted-text><run>Sales &amp; Profit</run></formatted-text></zone></zone></zones>
    <devicelayouts><devicelayout name="Phone"><size minheight="700"/>
    <zones><zone id="2" name="A" x="200" y="300" w="400" h="500"/></zones>
    </devicelayout></devicelayouts></dashboard>`;
  const candidate = `<workbook><dashboards>${dashboard}</dashboards><windows>
    <window class="dashboard" name="D"><viewpoints><viewpoint name="A"><zoom type="standard"/>
    <highlight field="Category"/></viewpoint></viewpoints></window></windows></workbook>`;
  const matches = createDashboardReadbackVerifier(candidate, 'D');

  it('ignores XML presentation and added metadata while preserving all authored content', () => {
    const serialized = candidate
      .replace('id="2" name="A" x="100"', 'name="A" x="101" id="2"')
      .replace('</dashboard>', '<simple-id uuid="generated"/></dashboard>')
      .replace(
        '<viewpoints>',
        '<viewpoints><viewpoint name="Removed"><zoom type="fit-width"/></viewpoint>',
      )
      .replaceAll('/>', ' />')
      .replaceAll('"', "'")
      .replaceAll('\n', '\n  ');
    expect(matches(serialized)).toBe(true);
  });

  it.each([
    {
      name: 'missing Phone layout',
      change: (xml: string) => xml.replace(/<devicelayouts>[\s\S]*?<\/devicelayouts>/, ''),
    },
    {
      name: 'changed Phone geometry',
      change: (xml: string) => xml.replace('w="400" h="500"', 'w="900" h="500"'),
    },
    {
      name: 'missing main layout despite a matching Phone worksheet',
      change: (xml: string) => xml.replace(/<zones>[\s\S]*?<\/zones>/, '<zones/>'),
    },
    {
      name: 'changed dashboard size',
      change: (xml: string) => xml.replace('minwidth="1000"', 'minwidth="900"'),
    },
    {
      name: 'dropped zone styling',
      change: (xml: string) => xml.replace(/<zone-style>[\s\S]*?<\/zone-style>/, ''),
    },
    {
      name: 'changed title',
      change: (xml: string) => xml.replace('Sales &amp; Profit', 'Other title'),
    },
    {
      name: 'changed retained zoom',
      change: (xml: string) => xml.replace('type="standard"', 'type="entire-view"'),
    },
    {
      name: 'dropped retained highlight',
      change: (xml: string) => xml.replace('<highlight field="Category"/>', ''),
    },
    {
      name: 'duplicate view registration',
      change: (xml: string) => xml.replace('<viewpoints>', '<viewpoints><viewpoint name="A"/>'),
    },
    {
      name: 'duplicate dashboard identity',
      change: (xml: string) => xml.replace('</dashboards>', '<dashboard name="D"/></dashboards>'),
    },
    {
      name: 'duplicate window identity',
      change: (xml: string) =>
        xml.replace('</windows>', '<window class="dashboard" name="D"/></windows>'),
    },
    {
      name: 'changed zone nesting',
      change: (xml: string) =>
        xml.replace(
          /<zone id="1" type-v2="layout-basic">([\s\S]*?)<\/zone><\/zones>/,
          '$1</zones>',
        ),
    },
    {
      name: 'extra layout object',
      change: (xml: string) => xml.replace('</zones>', '<zone id="99" type-v2="text"/></zones>'),
    },
  ])('rejects $name even when worksheet membership still matches', ({ change }) => {
    const actual = change(candidate);
    expect(actual).not.toBe(candidate);
    expect(dashboardMembershipMatches(actual, 'D', ['A'])).toBe(true);
    expect(matches(actual)).toBe(false);
  });

  it('does not treat missing empty attributes as preserved', () => {
    const withEmptyAttribute = candidate.replace('<run>', '<run fontname="">');
    expect(createDashboardReadbackVerifier(withEmptyAttribute, 'D')(candidate)).toBe(false);
  });

  it('matches namespaced settings by namespace while requiring their values', () => {
    const expected = candidate.replace(
      '<dashboard name="D">',
      '<dashboard name="D" xmlns:user="urn:tableau:user" user:setting="keep">',
    );
    const actual = expected
      .replaceAll('xmlns:user=', 'xmlns:other=')
      .replaceAll('user:setting=', 'other:setting=');
    const verify = createDashboardReadbackVerifier(expected, 'D');
    expect(verify(actual)).toBe(true);
    expect(verify(actual.replace('other:setting="keep"', 'other:setting="lost"'))).toBe(false);
    expect(verify(actual.replace(' other:setting="keep"', ''))).toBe(false);
  });

  it('rejects empty zone coordinates rather than interpreting them as zero', () => {
    const expected = candidate.replace('x="100"', 'x="0"');
    expect(createDashboardReadbackVerifier(expected, 'D')(expected.replace('x="0"', 'x=""'))).toBe(
      false,
    );
  });

  it('rejects malformed readback', () => {
    expect(matches('<workbook><dashboard')).toBe(false);
  });
});
