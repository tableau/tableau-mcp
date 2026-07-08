import { runValidation } from '../registry.js';
import { dashboardZonesReferenceIncludedWorksheetsRule } from './dashboardZonesReferenceIncludedWorksheets.js';

const RULE_ID = 'dashboard-zones-reference-included-worksheets';

describe('dashboard-zones-reference-included-worksheets rule', () => {
  it('is registered only for the workbook context', () => {
    expect(dashboardZonesReferenceIncludedWorksheetsRule.contexts).toEqual(['workbook']);
  });

  it('rejects a whole-workbook document when a dashboard zone references an omitted worksheet', () => {
    const result = runValidation(
      workbookXml({
        worksheets: ['Included Sheet'],
        dashboards: [
          {
            name: 'Executive Dashboard',
            zones: ["<zone h='98000' id='4' name='Missing Sheet' w='98000' x='1000' y='1000' />"],
          },
        ],
      }),
      'workbook',
    );

    const errors = result.issues.filter((i) => i.ruleId === RULE_ID && i.severity === 'error');
    expect(result.valid).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Executive Dashboard');
    expect(errors[0].message).toContain('Missing Sheet');
    expect(errors[0].message).toContain('include the worksheet in the document or remove the zone');
  });

  it('allows a whole-workbook document when dashboard zones reference included worksheets', () => {
    const result = runValidation(
      workbookXml({
        worksheets: ['Sales Trend', 'Region Count'],
        dashboards: [
          {
            name: 'Health Dash',
            zones: [
              "<zone h='98000' id='4' name='Sales Trend' w='49000' x='500' y='1000' />",
              "<zone h='98000' id='5' name='Region Count' w='49000' x='50500' y='1000' />",
            ],
          },
        ],
      }),
      'workbook',
    );

    expect(result.issues.filter((i) => i.ruleId === RULE_ID)).toEqual([]);
  });

  it('reports each missing worksheet referenced across multiple dashboards and zones', () => {
    const result = runValidation(
      workbookXml({
        worksheets: ['Included Sheet'],
        dashboards: [
          {
            name: 'Regional Dashboard',
            zones: [
              "<zone h='49000' id='4' name='Included Sheet' w='49000' x='500' y='1000' />",
              "<zone h='49000' id='5' name='Missing Regional' w='49000' x='50500' y='1000' />",
            ],
          },
          {
            name: 'Executive Dashboard',
            zones: ["<zone h='98000' id='6' name='Missing Executive' w='98000' x='1000' y='1000' />"],
          },
        ],
      }),
      'workbook',
    );

    const messages = result.issues
      .filter((i) => i.ruleId === RULE_ID)
      .map((i) => i.message);
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Missing Regional'),
        expect.stringContaining('Missing Executive'),
      ]),
    );
  });

  it('ignores dashboard zone types that do not reference worksheets', () => {
    const result = runValidation(
      workbookXml({
        worksheets: ['Sales Trend'],
        dashboards: [
          {
            name: 'Mixed Dashboard',
            zones: [
              "<zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>",
              "<zone h='20000' id='4' type-v2='text' w='98000' x='1000' y='1000'><zone-text><formatted-text><run>Title</run></formatted-text></zone-text></zone>",
              "<zone h='20000' id='5' type-v2='blank' w='98000' x='1000' y='25000' />",
              "<zone h='20000' id='6' name='Sales Trend' w='98000' x='1000' y='50000' />",
              '</zone>',
            ],
          },
        ],
      }),
      'workbook',
    );

    expect(result.issues.filter((i) => i.ruleId === RULE_ID)).toEqual([]);
  });

  it('does not run against the dashboard validation context used by per-dashboard apply', () => {
    const result = runValidation(
      workbookXml({
        worksheets: [],
        dashboards: [
          {
            name: 'Executive Dashboard',
            zones: ["<zone h='98000' id='4' name='Live Sheet' w='98000' x='1000' y='1000' />"],
          },
        ],
      }),
      'dashboard',
    );

    expect(result.issues.filter((i) => i.ruleId === RULE_ID)).toEqual([]);
  });
});

function workbookXml({
  worksheets,
  dashboards,
}: {
  worksheets: string[];
  dashboards: Array<{ name: string; zones: string[] }>;
}): string {
  const worksheetXml = worksheets
    .map((name) => `<worksheet name='${name}'><table /></worksheet>`)
    .join('');
  const dashboardXml = dashboards
    .map(
      ({ name, zones }) =>
        `<dashboard name='${name}'><zones><zone h='100000' id='3' type-v2='layout-basic' w='100000' x='0' y='0'>${zones.join(
          '',
        )}</zone></zones></dashboard>`,
    )
    .join('');
  return `<?xml version='1.0'?><workbook><worksheets>${worksheetXml}</worksheets><dashboards>${dashboardXml}</dashboards></workbook>`;
}
