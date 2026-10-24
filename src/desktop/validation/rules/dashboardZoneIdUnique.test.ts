import { introducedBlockingValidationIssues } from '../registry.js';
import { dashboardZoneIdUniqueRule } from './dashboardZoneIdUnique.js';

const zone = (id: string, name: string): string => `<zone id="${id}" name="${name}"/>`;
const dashboard = (name: string, zones: string, extra = '', attrs = ''): string =>
  `<dashboard name="${name}"${attrs}><zones>${zones}</zones>${extra}</dashboard>`;
const phone = (zones: string): string =>
  `<devicelayouts><devicelayout name="Phone"><zones>${zones}</zones></devicelayout></devicelayouts>`;

describe('dashboard-zone-id-unique', () => {
  it('flags two main-layout zones that share an id with one issue', () => {
    const issues = dashboardZoneIdUniqueRule.validate(
      dashboard('Overview', zone('7', 'Sales') + zone('7', 'Profit')),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ruleId: 'dashboard-zone-id-unique', severity: 'error' });
    expect(issues[0].message).toBe(
      'Dashboard "Overview" has 2 zones with id="7": "Profit", "Sales". Desktop keeps only one zone per id and drops the others without an error.',
    );
  });

  it('gives three zones at one id one issue naming all three', () => {
    const issues = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'C') + zone('7', 'A') + zone('7', 'B')),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('has 3 zones with id="7": "A", "B", "C".');
    expect(issues[0].suggestion).toBe(
      'Keep id="7" on the zone Desktop already shows, and give each other zone an unused id, such as id="8", id="9".',
    );
  });

  it('gives two duplicate groups different suggested ids', () => {
    const issues = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'A') + zone('7', 'B') + zone('8', 'C') + zone('8', 'E')),
    );
    expect(issues).toHaveLength(2);
    expect(issues[0].suggestion).toContain('such as id="9".');
    expect(issues[1].suggestion).toContain('such as id="10".');
  });

  it('waives a reordered existing pair but not a third zone added to it', () => {
    const baseline = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'A') + zone('7', 'B')),
    );
    const reordered = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'B') + zone('7', 'A')),
    );
    expect(introducedBlockingValidationIssues(baseline, reordered, 'dashboard')).toEqual([]);
    const tripled = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'A') + zone('7', 'B') + zone('7', 'C')),
    );
    expect(introducedBlockingValidationIssues(baseline, tripled, 'dashboard')).toHaveLength(1);
  });

  it('uses type-v2 when a zone has no name', () => {
    const xml = dashboard('D', '<zone id="3" type-v2="layout-flow"/><zone id="3" name="B"/>');
    expect(dashboardZoneIdUniqueRule.validate(xml)[0].message).toContain('"B", "layout-flow"');
  });

  it('treats "5" and "05" as the same id', () => {
    const issues = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('5', 'A') + zone('05', 'B')),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('id="5"');
    expect(issues[0].message).not.toContain('"05"');
  });

  it('passes distinct ids', () => {
    expect(
      dashboardZoneIdUniqueRule.validate(dashboard('D', zone('1', 'A') + zone('2', 'B'))),
    ).toEqual([]);
  });

  it('ignores zones with no id and ids with no canonical form', () => {
    const xml = dashboard(
      'D',
      zone('a', 'A') + zone('a', 'B') + '<zone name="C"/><zone name="D"/>',
    );
    expect(dashboardZoneIdUniqueRule.validate(xml)).toEqual([]);
  });

  it('lets a device layout reuse a main-layout id', () => {
    const xml = dashboard('D', zone('1', 'A') + zone('2', 'B'), phone(zone('1', 'A')));
    expect(dashboardZoneIdUniqueRule.validate(xml)).toEqual([]);
  });

  it('flags two zones in one device layout and names the layout', () => {
    const xml = dashboard('D', zone('1', 'A'), phone(zone('4', 'A') + zone('4', 'B')));
    const issues = dashboardZoneIdUniqueRule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('device layout "Phone"');
  });

  it('lets two dashboards in one workbook reuse ids', () => {
    const xml = `<workbook><dashboards>${dashboard('A', zone('1', 'X'))}${dashboard('B', zone('1', 'Y'))}</dashboards></workbook>`;
    expect(dashboardZoneIdUniqueRule.validate(xml)).toEqual([]);
  });

  it('flags a duplicate in each dashboard of a workbook', () => {
    const xml = `<workbook><dashboards>${dashboard('A', zone('1', 'X') + zone('1', 'Y'))}${dashboard('B', zone('2', 'X') + zone('2', 'Y'))}</dashboards></workbook>`;
    const issues = dashboardZoneIdUniqueRule.validate(xml);
    expect(issues).toHaveLength(2);
    expect(issues[0].message).toContain('"A"');
    expect(issues[1].message).toContain('"B"');
  });

  it('skips storyboards, which are not probed', () => {
    const xml = dashboard('S', zone('1', 'A') + zone('1', 'B'), '', ' type="storyboard"');
    expect(dashboardZoneIdUniqueRule.validate(xml)).toEqual([]);
  });

  it('suggests an id that no zone uses', () => {
    const xml = dashboard('D', zone('7', 'A') + zone('7', 'B') + zone('9', 'C'));
    expect(dashboardZoneIdUniqueRule.validate(xml)[0].suggestion).toBe(
      'Keep id="7" on the zone Desktop already shows, and give each other zone an unused id, such as id="10".',
    );
  });

  it('suggests ids that no zone uses, however its id is written', () => {
    const three = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'A') + zone('7', 'B') + zone('08', 'C')),
    );
    expect(three[0].suggestion).toContain('such as id="9".');
    const padded = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('01', 'A') + zone('01', 'B')),
    );
    expect(padded[0].suggestion).toContain('such as id="2".');
  });

  it('suggests exact, different ids for ids beyond the safe integer range', () => {
    const big = '9007199254740993';
    const issues = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone(big, 'A') + zone(big, 'B') + zone(big, 'C')),
    );
    expect(issues[0].suggestion).toContain('such as id="9007199254740994", id="9007199254740995".');
    const huge = '9'.repeat(400);
    const hugeIssues = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone(huge, 'A') + zone(huge, 'B')),
    );
    expect(hugeIssues[0].suggestion).not.toContain('Infinity');
    expect(hugeIssues[0].suggestion).toContain(`id="1${'0'.repeat(400)}"`);
  });

  it('keeps the same key when the first zone writes the id differently', () => {
    const baseline = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('5', 'A') + zone('05', 'B')),
    );
    const reordered = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('05', 'B') + zone('5', 'A')),
    );
    expect(introducedBlockingValidationIssues(baseline, reordered, 'dashboard')).toEqual([]);
  });

  it('keeps the same message and xpath for the same duplicate in two documents', () => {
    const a = dashboardZoneIdUniqueRule.validate(dashboard('D', zone('7', 'A') + zone('7', 'B')));
    const b = dashboardZoneIdUniqueRule.validate(
      dashboard('D', zone('7', 'A') + zone('7', 'B') + zone('9', 'C'), phone(zone('1', 'A'))),
    );
    expect(b[0].message).toBe(a[0].message);
    expect(b[0].xpath).toBe(a[0].xpath);
  });

  it('returns nothing for malformed XML', () => {
    expect(dashboardZoneIdUniqueRule.validate('<dashboard')).toEqual([]);
  });
});
