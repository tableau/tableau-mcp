import { dashboardCardZoneNameRule } from './dashboardCardZoneName.js';

const EAGER_ZONE =
  "<zone h='100000' id='8' param='[federated.csv040059ff380b040059ff380b].[none:product_line:nk]' type-v2='filter' w='20000' x='80000' y='0' />";

const sheet = (name: string, id = '1'): string => `<zone id="${id}" name="${name}" />`;
const dashboard = (name: string, zones: string, extra = ''): string =>
  `<dashboard name="${name}"><zones>${zones}</zones>${extra}</dashboard>`;
const flow = (children: string): string =>
  `<zone type-v2="layout-flow" param="horz">${children}</zone>`;

describe('dashboard-card-zone-name', () => {
  it('flags the eager-1 nameless filter zone inside a horz flow', () => {
    const issues = dashboardCardZoneNameRule.validate(
      dashboard('Overview', flow(`${sheet('Revenue')}${EAGER_ZONE}`)),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ruleId: 'dashboard-card-zone-name', severity: 'error' });
    expect(issues[0].message).toContain('"Overview"');
    expect(issues[0].message).toContain('id="8"');
    expect(issues[0].message).toContain('type-v2="filter"');
    expect(issues[0].message).toContain('[none:product_line:nk]');
    expect(issues[0].message).toContain('can crash');
    expect(issues[0].message).not.toContain('always');
    expect(issues[0].suggestion).toContain('Add name="<worksheet>"');
    expect(issues[0].suggestion).toContain('"Revenue"');
  });

  it.each(['filter', 'color', 'size', 'shape', 'highlighter'])('flags a nameless %s zone', (t) => {
    expect(
      dashboardCardZoneNameRule.validate(dashboard('D', `<zone id="2" type-v2="${t}" />`)),
    ).toHaveLength(1);
  });

  it.each(['name=""', 'name="  "'])('flags a blank name (%s)', (attr) => {
    expect(
      dashboardCardZoneNameRule.validate(
        dashboard('D', `<zone id="2" ${attr} type-v2="filter" />`),
      ),
    ).toHaveLength(1);
  });

  it('flags a nameless card inside a device layout', () => {
    const xml = dashboard(
      'D',
      sheet('A'),
      `<devicelayouts><devicelayout name="Phone"><zones>${flow(EAGER_ZONE)}</zones></devicelayout></devicelayouts>`,
    );
    const issues = dashboardCardZoneNameRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('(device layout "Phone")');
    expect(issues[0].suggestion).toContain('"A"');
  });

  it('tells the main-layout zone and its device-layout copy apart', () => {
    const xml = dashboard(
      'D',
      `${sheet('A')}${EAGER_ZONE}`,
      `<devicelayouts><devicelayout name="Phone"><zones>${EAGER_ZONE}</zones></devicelayout></devicelayouts>`,
    );
    const issues = dashboardCardZoneNameRule.validate(xml);

    expect(issues).toHaveLength(2);
    expect(issues[0].message).not.toBe(issues[1].message);
    expect(issues[0].message).not.toContain('device layout');
    expect(issues[0].message).toContain('zone id="8" type-v2="filter"');
    expect(issues[1].message).toContain('zone id="8" (device layout "Phone") type-v2="filter"');
  });

  it('reports each dashboard separately and lists only its own worksheet zones', () => {
    const xml = `<workbook><dashboards>${dashboard('One', `${sheet('Alpha')}${sheet('Alpha', '3')}<zone id="2" type-v2="color" />`)}${dashboard('Two', `${sheet('Beta', '4')}<zone id="5" type-v2="size" />`)}</dashboards></workbook>`;
    const issues = dashboardCardZoneNameRule.validate(xml);

    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('"One"');
    expect(issues[0].suggestion).toContain('"Alpha"');
    expect(issues[0].suggestion?.match(/"Alpha"/g)).toHaveLength(1);
    expect(issues[0].suggestion).not.toContain('Beta');
    expect(issues[1].message).toContain('"Two"');
    expect(issues[1].suggestion).toContain('"Beta"');
    expect(issues[1].suggestion).not.toContain('Alpha');
  });

  it('tells the agent to add the worksheet zone first when the dashboard has none', () => {
    const [issue] = dashboardCardZoneNameRule.validate(dashboard('Empty', EAGER_ZONE));
    expect(issue.suggestion).toContain('no worksheet zones');
    expect(issue.suggestion).toContain('add the worksheet zone first');
  });

  it('keeps the message and xpath identical for an unchanged zone', () => {
    const a = dashboardCardZoneNameRule.validate(dashboard('D', `${sheet('A')}${EAGER_ZONE}`));
    const b = dashboardCardZoneNameRule.validate(
      dashboard('D', `${sheet('A')}${sheet('B', '3')}${EAGER_ZONE}`),
    );
    expect(b[0].message).toBe(a[0].message);
    expect(b[0].xpath).toBe(a[0].xpath);
  });

  it('leaves non-card, named and wrongly named zones alone', () => {
    const zones = [
      '<zone id="1" type-v2="paramctrl" param="[Parameters].[Parameter 1]" />',
      '<zone id="2" type-v2="text" />',
      '<zone id="3" type-v2="empty" />',
      '<zone id="4" type-v2="layout-basic" />',
      '<zone id="5" type-v2="layout-flow" param="horz" />',
      '<zone id="6" type-v2="title" />',
      '<zone id="7" type-v2="bitmap" />',
      '<zone id="8" type-v2="web" />',
      '<zone id="9" name="Revenue" type-v2="filter" />',
      '<zone id="10" name="No Such Sheet" type-v2="color" />',
      sheet('Revenue', '11'),
    ].join('');
    expect(dashboardCardZoneNameRule.validate(dashboard('D', zones))).toEqual([]);
  });

  it('passes a storyboard document', () => {
    const xml =
      '<dashboard name="Story" type="storyboard"><zones><zone type-v2="flipboard"><flipboard active-id="1" nav-type="caption"><flipboard-zone id="7" /></flipboard></zone><zone story-point-id="1" /><zone flipboard-zone-id="7" /></zones></dashboard>';
    expect(dashboardCardZoneNameRule.validate(xml)).toEqual([]);
  });

  it('ignores malformed XML', () => {
    expect(dashboardCardZoneNameRule.validate('<dashboard><zone')).toEqual([]);
  });
});
