import { createDashboardReadbackDiagnoser } from './dashboardViewpoints.js';

const dashboard = `<dashboard name="D" minwidth="1000"><size minwidth="1000"/>
  <zones><zone id="2" name="A" x="100" y="200" w="400" h="500" type-v2="layout-basic">
    <zone id="3" param="[p].[Sales by Region]" type-v2="paramctrl" x="100" y="200" w="400" h="100" layout-strategy-id="distribute-evenly"/>
  </zone></zones></dashboard>`;
const workbook = (
  dash: string,
  viewpoints = '<viewpoint name="A"><zoom type="standard"/></viewpoint>',
): string =>
  `<workbook><dashboards>${dash}</dashboards><windows><window class="dashboard" name="D"><viewpoints>${viewpoints}</viewpoints></window></windows></workbook>`;
const spacing =
  '<zone-style><format attr="margin" value="0"/><format attr="padding" value="0"/><format attr="border-width" value="0"/></zone-style>';
const layoutFixture = (type: string, extra: string, heights: number[]): string => {
  let offset = 0;
  const kids = heights.map((h, index) => {
    const y = offset;
    offset += h;
    const visual = index < 2 ? ` name="Sheet ${index}" type-v2="visual"` : ' type-v2="text"';
    const cache =
      index < 2
        ? '<layout-cache type-w="scalable" type-h="scalable" minwidth="100" minheight="100" has-max-size-w="false" has-max-size-h="false"/>'
        : '<formatted-text><run>Title</run></formatted-text>';
    return `<zone id="${index + 2}" x="0" y="${y}" w="1000" h="${h}"${visual}>${cache}${spacing}</zone>`;
  });
  const sheets = ['Sheet 0', 'Sheet 1'];
  return `<workbook><worksheets>${sheets.map((n) => `<worksheet name="${n}"><table><rows/><cols/></table></worksheet>`).join('')}</worksheets>
    <dashboards><dashboard name="D"><size minwidth="1000" maxwidth="1000" minheight="1000" maxheight="1000"/>
    <zones><zone id="1" type-v2="${type}" ${extra} x="0" y="0" w="1000" h="1000">${kids.join('')}${spacing}</zone></zones></dashboard></dashboards>
    <windows><window class="dashboard" name="D"><viewpoints>${sheets.map((n) => `<viewpoint name="${n}"/>`).join('')}</viewpoints></window></windows></workbook>`;
};
const flowDifference = (actual: number[]): string | undefined =>
  createDashboardReadbackDiagnoser(
    layoutFixture('layout-flow', 'param="vert"', [300, 600, 100]),
    'D',
  )(layoutFixture('layout-flow', 'param="vert"', actual));
const basicDifference = (first: number): string | undefined =>
  createDashboardReadbackDiagnoser(
    layoutFixture('layout-basic', '', [300, 600, 100]),
    'D',
  )(layoutFixture('layout-basic', '', [first, 600, 100]));
const submitted = workbook(dashboard);
const difference = (actual: string): string | undefined =>
  createDashboardReadbackDiagnoser(submitted, 'D')(actual);

describe('dashboard readback reasons', () => {
  it('returns undefined when the readback matches', () => {
    expect(difference(submitted)).toBeUndefined();
  });

  it('names the zone and both values for an attribute mismatch', () => {
    expect(difference(submitted.replace('type-v2="layout-basic"', 'type-v2="layout-flow"'))).toBe(
      'zone 2 ("A"): type-v2 is "layout-flow" in Desktop, "layout-basic" submitted',
    );
  });

  it('names the zone and both values for a geometry deviation', () => {
    expect(difference(submitted.replace('w="400" h="500"', 'w="384" h="500"'))).toBe(
      'zone 2 ("A"): w is "384" in Desktop, "400" submitted',
    );
  });

  it('names a missing attribute on a zone identified by its parameter', () => {
    expect(difference(submitted.replace(' layout-strategy-id="distribute-evenly"', ''))).toBe(
      'zone 3 ("[p].[Sales by Region]"): layout-strategy-id is missing in Desktop, "distribute-evenly" submitted',
    );
  });

  it('reports a child count difference', () => {
    expect(difference(submitted.replace(/<zone id="3"[^>]*\/>/, ''))).toBe(
      'zone 2 ("A") has 0 child zones in Desktop, 1 submitted',
    );
  });

  describe('child count with a non-zone child', () => {
    const styled = workbook(dashboard.replace('/>\n  </zone>', `/>\n  ${spacing}</zone>`));
    const styledDifference = (actual: string): string | undefined =>
      createDashboardReadbackDiagnoser(styled, 'D')(actual);

    it('names the missing non-zone child instead of calling it a child zone', () => {
      expect(styledDifference(styled.replace(spacing, ''))).toBe(
        'zone 2 ("A") has 0 <zone-style> children in Desktop, 1 submitted',
      );
    });

    it('still says child zones when a zone is missing next to other children', () => {
      expect(styledDifference(styled.replace(/<zone id="3"[^>]*\/>/, ''))).toBe(
        'zone 2 ("A") has 0 child zones in Desktop, 1 submitted',
      );
    });
  });

  it('names the child kind for the devicelayouts container', () => {
    const layouts = (inner: string): string =>
      workbook(
        dashboard.replace('</dashboard>', `<devicelayouts>${inner}</devicelayouts></dashboard>`),
      );
    expect(
      createDashboardReadbackDiagnoser(
        layouts('<devicelayout name="Phone"><size minwidth="1"/></devicelayout>'),
        'D',
      )(layouts('')),
    ).toBe('<devicelayouts> has 0 <devicelayout> children in Desktop, 1 submitted');
  });

  it('reports a layout geometry failure from layoutGeometryDifference', () => {
    expect(difference(submitted.replace('<zone id="2"', '<zone is-fixed="true" id="2"'))).toBe(
      'zone 2 ("A"): is-fixed is true in Desktop, false submitted',
    );
  });

  it('reports a viewpoint count difference', () => {
    expect(difference(workbook(dashboard, ''))).toBe(
      'worksheet "A" has 0 viewpoints in Desktop, expected 1',
    );
  });

  it('reports an extra worksheet zone', () => {
    const extra = dashboard.replace(
      '</zone></zones>',
      '<zone id="9" name="B" x="100" y="300" w="400" h="400"/></zone></zones>',
    );
    expect(difference(workbook(extra))).toBe(
      'zone 2 ("A") has 2 child zones in Desktop, 1 submitted',
    );
  });

  it('reports a missing dashboard', () => {
    expect(
      createDashboardReadbackDiagnoser(
        submitted,
        'D',
      )('<workbook><dashboards></dashboards><windows></windows></workbook>'),
    ).toBe('Desktop does not have exactly one dashboard and one dashboard window named "D"');
  });

  it('reports a worksheet count difference', () => {
    const visual = submitted.replace(
      /<zone id="3"[^>]*\/>/,
      '<zone id="3" name="A" type-v2="visual"/>',
    );
    const hidden = visual.replace(
      '<zone id="3" name="A" type-v2="visual"/>',
      '<zone id="3" name="A" type-v2="visual"><junk><zone id="9" name="B"/></junk></zone>',
    );
    expect(createDashboardReadbackDiagnoser(visual, 'D')(hidden)).toBe(
      'the dashboard has 2 worksheet zones in Desktop, 1 submitted',
    );
  });

  it('reports a layout area that the flow allocation does not match', () => {
    expect(flowDifference([400, 500, 100])).toBe(
      'zone 1 ("vert"): child heights are [400, 500, 100] in Desktop, which does not match the allocation of the submitted [300, 600, 100] in 1000px',
    );
  });

  it('reports a basic layout that is not where normalizing puts it', () => {
    expect(basicDifference(380)).toBe(
      'zone 2 ("Sheet 0"): position is x=0 y=0 w=1000 h=380 in Desktop, x=0 y=0 w=1000 h=300 expected after normalizing the submitted layout',
    );
  });

  it('clips a long text run to a bounded reason', () => {
    const run = (text: string): string =>
      workbook(
        dashboard.replace(
          '<zone id="3"',
          `<zone id="4" type-v2="text"><formatted-text><run>${text}</run></formatted-text></zone><zone id="3"`,
        ),
      );
    const reason = createDashboardReadbackDiagnoser(
      run('a'.repeat(6000)),
      'D',
    )(run(`${'a'.repeat(3000)}b${'a'.repeat(3000)}`));
    expect(reason).toMatch(/^<run>: text is "…a+ba+…" in Desktop/);
    expect(reason!.length).toBeLessThanOrEqual(301);
  });

  it('prints names with quotes and newlines on one line', () => {
    const named = workbook(
      dashboard.replace('name="A"', 'name="a &quot;q&quot;&#10;b"'),
      '<viewpoint name="x"/>',
    );
    const reason = createDashboardReadbackDiagnoser(
      named,
      'D',
    )(named.replace('type-v2="layout-basic"', 'type-v2="layout-flow"'));
    expect(reason).toBe(
      'zone 2 ("a \\"q\\"\\nb"): type-v2 is "layout-flow" in Desktop, "layout-basic" submitted',
    );
    expect(reason).not.toContain('\n');
  });

  it('reports a malformed readback instead of throwing', () => {
    expect(difference('<workbook><dashboard')).toMatch(/^the readback could not be checked: /);
  });
});
