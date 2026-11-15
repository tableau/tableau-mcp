import { dashboardZoneIdNumberRule } from './dashboardZoneIdNumber.js';

const zone = (id: string, name = 'Sales'): string => `<zone id="${id}" name="${name}"/>`;
const dashboard = (name: string, zones: string, extra = ''): string =>
  `<dashboard name="${name}"><zones>${zones}</zones>${extra}</dashboard>`;

describe('dashboard-zone-id-number', () => {
  it.each(['05', '007', '00', '+5', ' 5', '5 ', '5.0', '-1', 'a', ''])(
    'flags the zone id %j',
    (id) => {
      const issues = dashboardZoneIdNumberRule.validate(dashboard('Overview', zone(id)));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ ruleId: 'dashboard-zone-id-number', severity: 'error' });
      expect(issues[0].message).toContain('"Overview"');
      expect(issues[0].message).toContain(`id="${id}"`);
      expect(issues[0].message).toContain('(Sales)');
      expect(issues[0].message).toContain('Desktop treats id="05" as zone 5');
    },
  );

  it.each(['0', '5', '123'])('passes the zone id %j', (id) => {
    expect(dashboardZoneIdNumberRule.validate(dashboard('D', zone(id)))).toEqual([]);
  });

  it('does not flag a zone with no id', () => {
    expect(dashboardZoneIdNumberRule.validate(dashboard('D', '<zone name="A"/>'))).toEqual([]);
  });

  it('flags a device-layout zone and names the layout', () => {
    const xml = dashboard(
      'D',
      zone('1'),
      `<devicelayouts><devicelayout name="Phone"><zones>${zone('05')}</zones></devicelayout></devicelayouts>`,
    );
    const issues = dashboardZoneIdNumberRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('device layout "Phone"');
  });

  it('gives each dashboard in a workbook its own issue', () => {
    const xml = `<workbook><dashboards>${dashboard('A', zone('05'))}${dashboard('B', zone('06'))}</dashboards></workbook>`;
    const issues = dashboardZoneIdNumberRule.validate(xml);
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('"A"');
    expect(issues[1].message).toContain('"B"');
  });

  it('checks storyboards', () => {
    const storyboard = (id: string): string =>
      `<dashboard name="S" type="storyboard"><zones>${zone(id)}</zones></dashboard>`;
    expect(dashboardZoneIdNumberRule.validate(storyboard('5'))).toEqual([]);
    expect(dashboardZoneIdNumberRule.validate(storyboard('05'))).toHaveLength(1);
  });

  it('keeps the same message for an unchanged zone so baseline comparison matches', () => {
    const a = dashboardZoneIdNumberRule.validate(dashboard('D', zone('05')));
    const b = dashboardZoneIdNumberRule.validate(dashboard('D', zone('05') + zone('2', 'Other')));
    expect(b[0].message).toBe(a[0].message);
    expect(b[0].xpath).toBe(a[0].xpath);
  });

  it.each([
    ['05', 'Write it as id="5".'],
    ['00', 'Write it as id="0".'],
    ['+5', 'Write it as id="5".'],
    [' 007 ', 'Write it as id="7".'],
  ])('suggests the canonical form of %j', (id, expected) => {
    expect(dashboardZoneIdNumberRule.validate(dashboard('D', zone(id)))[0].suggestion).toBe(
      expected,
    );
  });

  it('suggests the next free number for an id that is not digits', () => {
    const xml = dashboard('D', zone('a') + zone('4', 'B') + zone('2', 'C'));
    expect(dashboardZoneIdNumberRule.validate(xml)[0].suggestion).toBe(
      'Use a whole number such as id="5" that no other zone on this dashboard uses.',
    );
    expect(dashboardZoneIdNumberRule.validate(dashboard('D', zone('a')))[0].suggestion).toContain(
      'id="1"',
    );
  });

  it.each([
    ['5 and 05', zone('5', 'A') + zone('05', 'B'), 'id="6"', 1],
    ['05 and 005', zone('05', 'A') + zone('005', 'B'), 'id="6"', 2],
  ])(
    'falls back to the next free number when the canonical id is taken: %s',
    (_l, zones, hint, count) => {
      const issues = dashboardZoneIdNumberRule.validate(dashboard('D', zones));
      expect(issues).toHaveLength(count);
      for (const issue of issues) expect(issue.suggestion).toContain(`such as ${hint}`);
    },
  );

  it('skips a taken non-plain id when it falls back to the next free number', () => {
    const xml = dashboard('D', zone('a') + zone('7', 'B') + zone('08', 'C'));
    expect(dashboardZoneIdNumberRule.validate(xml)[0].suggestion).toContain('such as id="9"');
  });

  it('scopes the collision check to one layout', () => {
    const xml = dashboard(
      'D',
      zone('05', 'A'),
      `<devicelayouts><devicelayout name="Phone"><zones>${zone('05', 'A')}</zones></devicelayout></devicelayouts>`,
    );
    const issues = dashboardZoneIdNumberRule.validate(xml);
    expect(issues.map((i) => i.suggestion)).toEqual(['Write it as id="5".', 'Write it as id="5".']);
  });

  it('still falls back when the taken id is in the same device layout', () => {
    const xml = dashboard(
      'D',
      zone('1'),
      `<devicelayouts><devicelayout name="Phone"><zones>${zone('5', 'A')}${zone('05', 'B')}</zones></devicelayout></devicelayouts>`,
    );
    expect(dashboardZoneIdNumberRule.validate(xml)[0].suggestion).toContain('such as id="6"');
  });
});
