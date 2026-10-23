import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

import {
  readbackReflowDashboard,
  REFLOW_DASHBOARD_NAME,
  reflowWorkbook,
  submittedReflowDashboard,
} from './dashboardReflowFixtures.js';
import {
  composeDashboardWorkbook,
  createDashboardReadbackVerifier,
  dashboardMembershipMatches,
  dashboardWorksheetNames,
  synchronizeDashboardViewpoints,
} from './dashboardViewpoints.js';

describe('dashboard viewpoint registration', () => {
  it('accepts native defaults for new views while requiring retained settings for existing views', () => {
    const source =
      '<workbook><worksheets><worksheet name="A"/><worksheet name="B"/></worksheets><dashboards><dashboard name="D"><zones><zone name="A"/></zones></dashboard></dashboards><windows><window class="dashboard" name="D"><viewpoints><viewpoint name="A"><zoom type="fit-width"/></viewpoint></viewpoints></window></windows></workbook>';
    const expected = composeDashboardWorkbook(
      source,
      'D',
      '<dashboard name="D"><zones><zone name="A"/><zone name="B"/></zones></dashboard>',
      { useNativeViewpointDefaults: true },
    ).unwrap().xml;
    expect(expected).toContain('<viewpoint name="B"/>');
    const matches = createDashboardReadbackVerifier(expected, 'D');
    expect(matches(expected)).toBe(true);
    expect(matches(expected.replace('<viewpoint name="B"/>', ''))).toBe(false);
    expect(matches(expected.replace('fit-width', 'entire-view'))).toBe(false);
  });

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

describe('Desktop tiled-layout reflow', () => {
  const submitted = reflowWorkbook(submittedReflowDashboard);
  const readback = reflowWorkbook(readbackReflowDashboard);
  const matches = createDashboardReadbackVerifier(submitted, REFLOW_DASHBOARD_NAME);

  function zoneAttribute(xml: string, id: string, attribute: string, value: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const zone = Array.from(doc.getElementsByTagName('zone')).find(
      (element) => element.getAttribute('id') === id,
    )!;
    zone.setAttribute(attribute, value);
    return new XMLSerializer().serializeToString(doc);
  }

  function floatFlowContainer(xml: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const flow = Array.from(doc.getElementsByTagName('zone')).find(
      (element) => element.getAttribute('id') === '5',
    )!;
    // Native floating containers are siblings of the tiled layout-basic root.
    doc.getElementsByTagName('zones')[0].appendChild(flow);
    return new XMLSerializer().serializeToString(doc);
  }

  function moveCoordinate(xml: string, id: string, attribute: string): string {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const zone = Array.from(doc.getElementsByTagName('zone')).find(
      (element) => element.getAttribute('id') === id,
    )!;
    return zoneAttribute(xml, id, attribute, String(Number(zone.getAttribute(attribute)) + 100));
  }

  function siblingFlows(start: number, split: number, end: number, horizontal = true): string {
    const rect = (left: number, right: number): string =>
      horizontal
        ? `x="${left}" y="${start}" w="${right - left}" h="${end - start}"`
        : `x="${start}" y="${left}" w="${end - start}" h="${right - left}"`;
    return reflowWorkbook(`<dashboard name="${REFLOW_DASHBOARD_NAME}">
      <size minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"/>
      <zones><zone id="4" type-v2="layout-basic" x="0" y="0" w="100000" h="100000">
        <zone id="5" type-v2="layout-flow" param="vert" ${rect(start, split)}>
          <zone id="6" type-v2="empty" ${rect(start, split)}/>
        </zone>
        <zone id="8" type-v2="layout-flow" param="vert" ${rect(split, end)}>
          <zone id="9" type-v2="empty" ${rect(split, end)}/>
        </zone>
      </zone></zones></dashboard>`);
  }

  it('accepts the captured tiled reflow with native metadata and matching viewpoint state', () => {
    expect(matches(submitted)).toBe(true);
    expect(matches(readback)).toBe(true);
  });

  it.each([
    { name: 'empty coordinate', attribute: 'x', value: '' },
    { name: 'noninteger coordinate', attribute: 'y', value: '0.5' },
    { name: 'zero-width worksheet', attribute: 'w', value: '0' },
    { name: 'negative-height worksheet', attribute: 'h', value: '-1' },
  ])('still rejects a $name after reflow', ({ attribute, value }) => {
    expect(matches(zoneAttribute(readback, '7', attribute, value))).toBe(false);
  });

  it.each([
    { zoneId: '5', attribute: 'is-fixed', value: 'true' },
    { zoneId: '7', attribute: 'is-fixed', value: '1' },
    { zoneId: '7', attribute: 'is-fixed', value: 'true' },
    { zoneId: '7', attribute: 'fixed-size', value: '600' },
  ])('preserves authored geometry for zone $zoneId with $attribute=$value', (setting) => {
    const expected = zoneAttribute(submitted, setting.zoneId, setting.attribute, setting.value);
    const actual = zoneAttribute(readback, setting.zoneId, setting.attribute, setting.value);
    expect(createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME)(actual)).toBe(false);
    const unchanged = zoneAttribute(readback, setting.zoneId, setting.attribute, setting.value);
    const matchesFixed = createDashboardReadbackVerifier(unchanged, REFLOW_DASHBOARD_NAME);
    expect(matchesFixed(unchanged)).toBe(true);
    for (const coordinate of ['x', 'y', 'w', 'h']) {
      expect(matchesFixed(moveCoordinate(unchanged, setting.zoneId, coordinate))).toBe(false);
    }
  });

  it('still rejects changed bounds of a floating flow container', () => {
    const expected = floatFlowContainer(submitted);
    const actual = floatFlowContainer(readback);
    const matchesFloating = createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME);
    expect(matchesFloating(expected)).toBe(true);
    expect(matchesFloating(actual)).toBe(false);
    const unchanged = floatFlowContainer(readback);
    const matchesUnchanged = createDashboardReadbackVerifier(unchanged, REFLOW_DASHBOARD_NAME);
    expect(matchesUnchanged(unchanged)).toBe(true);
    for (const coordinate of ['x', 'y', 'w', 'h']) {
      expect(matchesUnchanged(moveCoordinate(unchanged, '5', coordinate))).toBe(false);
    }
  });

  it.each([true, false])(
    'preserves sibling proportions and positions (horizontal=%s)',
    (horizontal) => {
      const expected = siblingFlows(0, 50000, 100000, horizontal);
      const verify = createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME);
      expect(verify(expected)).toBe(true);
      expect(verify(siblingFlows(0, 10000, 100000, horizontal))).toBe(false);
      let swapped = expected;
      for (const id of ['5', '6', '8', '9']) {
        swapped = zoneAttribute(
          swapped,
          id,
          horizontal ? 'x' : 'y',
          Number(id) < 8 ? '50000' : '0',
        );
      }
      expect(verify(swapped)).toBe(false);
    },
  );

  it.each([true, false])(
    'accepts common basic-child normalization (horizontal=%s)',
    (horizontal) => {
      const expected = siblingFlows(1000, 25500, 99000, horizontal);
      const actual = siblingFlows(0, 25000, 100000, horizontal);
      expect(createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME)(actual)).toBe(true);
    },
  );

  it('accepts integer rounding during common basic-child scaling', () => {
    const expected = siblingFlows(1000, 25001, 99000);
    const actual = siblingFlows(0, 24490, 100000);
    expect(createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME)(actual)).toBe(true);
  });

  it('requires authored spacing for an inset flow client rectangle', () => {
    // At 1024 x 768, native conversion rounds each 8px inset to 781 x 1042.
    let actual = zoneAttribute(readback, '6', 'x', '781');
    actual = zoneAttribute(actual, '6', 'y', '1042');
    actual = zoneAttribute(actual, '6', 'w', '98438');
    actual = zoneAttribute(actual, '7', 'x', '781');
    actual = zoneAttribute(actual, '7', 'y', '7422');
    actual = zoneAttribute(actual, '7', 'w', '98438');
    actual = zoneAttribute(actual, '7', 'h', '91536');
    expect(matches(actual)).toBe(false);
    const withMargin = (xml: string): string => {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const flow = Array.from(doc.getElementsByTagName('zone')).find(
        (zone) => zone.getAttribute('id') === '5',
      )!;
      const style = doc.createElement('zone-style');
      const format = doc.createElement('format');
      format.setAttribute('attr', 'margin');
      format.setAttribute('value', '8');
      style.appendChild(format);
      flow.appendChild(style);
      return new XMLSerializer().serializeToString(doc);
    };
    expect(
      createDashboardReadbackVerifier(
        withMargin(submitted),
        REFLOW_DASHBOARD_NAME,
      )(withMargin(actual)),
    ).toBe(true);
  });

  it('accepts reflow inside a floating container outside the dashboard', () => {
    const place = (xml: string): string => {
      let moved = floatFlowContainer(xml);
      for (const id of ['5', '6', '7']) {
        moved = zoneAttribute(moved, id, 'x', '200000');
        moved = zoneAttribute(moved, id, 'w', '100000');
      }
      moved = zoneAttribute(moved, '5', 'y', '0');
      return zoneAttribute(moved, '5', 'h', '100000');
    };
    const expected = place(submitted);
    const actual = place(readback);
    expect(createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME)(actual)).toBe(true);
  });

  it('checks the corresponding axes of horizontal flow reflow', () => {
    const transpose = (xml: string): string => {
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const zone of Array.from(doc.getElementsByTagName('zone'))) {
        for (const [a, b] of [
          ['x', 'y'],
          ['w', 'h'],
        ]) {
          const value = zone.getAttribute(a)!;
          zone.setAttribute(a, zone.getAttribute(b)!);
          zone.setAttribute(b, value);
        }
        for (const cache of Array.from(zone.getElementsByTagName('layout-cache')).filter(
          (element) => element.parentNode === zone,
        )) {
          for (const [a, b] of [
            ['type-w', 'type-h'],
            ['minwidth', 'minheight'],
            ['maxwidth', 'maxheight'],
            ['fixed-size-w', 'fixed-size-h'],
            ['has-max-size-w', 'has-max-size-h'],
          ]) {
            const first = cache.getAttribute(a);
            const second = cache.getAttribute(b);
            if (second === null) cache.removeAttribute(a);
            else cache.setAttribute(a, second);
            if (first === null) cache.removeAttribute(b);
            else cache.setAttribute(b, first);
          }
        }
        if (zone.getAttribute('id') === '5') zone.setAttribute('param', 'horz');
      }
      return new XMLSerializer().serializeToString(doc);
    };
    const expected = transpose(submitted);
    const actual = transpose(readback);
    const verify = createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME);
    expect(verify(actual)).toBe(true);
    expect(verify(zoneAttribute(actual, '7', 'y', '200000'))).toBe(false);
    expect(verify(zoneAttribute(actual, '7', 'x', '0'))).toBe(false);
  });

  it.each([
    { attribute: 'x', value: '200000' },
    { attribute: 'x', value: '-200000' },
    { attribute: 'y', value: '200000' },
    { attribute: 'y', value: '0' },
    { attribute: 'w', value: '50000' },
  ])('rejects an invalid flow relationship ($attribute=$value)', ({ attribute, value }) => {
    const verify = createDashboardReadbackVerifier(readback, REFLOW_DASHBOARD_NAME);
    expect(verify(zoneAttribute(readback, '7', attribute, value))).toBe(false);
  });

  it.each([
    { zoneId: '7', value: 'true' },
    { zoneId: '7', value: '1' },
    { zoneId: '5', value: 'true' },
    { zoneId: '4', value: 'true' },
  ])('preserves effectively hidden worksheet bounds (zone $zoneId)', ({ zoneId, value }) => {
    const expected = zoneAttribute(readback, zoneId, 'hidden-by-user', value);
    const verify = createDashboardReadbackVerifier(expected, REFLOW_DASHBOARD_NAME);
    expect(verify(expected)).toBe(true);
    expect(verify(zoneAttribute(expected, '7', 'w', '50000'))).toBe(false);
    for (const coordinate of ['x', 'y', 'w', 'h']) {
      expect(verify(moveCoordinate(expected, '7', coordinate))).toBe(false);
    }
  });

  it('still requires the native worksheet registration after reflow', () => {
    expect(matches(reflowWorkbook(readbackReflowDashboard, false))).toBe(false);
  });

  it('still rejects a changed flow direction, worksheet, title, style, or dashboard size', () => {
    const changed = [
      zoneAttribute(readback, '5', 'param', 'horz'),
      zoneAttribute(readback, '7', 'name', 'Another worksheet'),
      readback.replace('Coachella Artists per Day: 2022 vs 2026', 'Changed title'),
      readback.replace("fontsize='20'", "fontsize='10'"),
      readback.replace("maxwidth='1024'", "maxwidth='900'"),
    ];
    for (const xml of changed) {
      expect(xml).not.toBe(readback);
      expect(matches(xml)).toBe(false);
    }
  });
});
