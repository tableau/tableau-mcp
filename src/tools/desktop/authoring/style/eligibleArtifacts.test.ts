import type { WorkbookInventory } from '../../../../desktop/externalApi/types.js';
import { eligibleStyleArtifacts } from './eligibleArtifacts.js';

const inventory: WorkbookInventory = {
  title: 'Book 1',
  unsavedChanges: false,
  worksheets: [
    { id: 'ws-visible', name: 'Visible Sheet', hidden: false },
    { id: 'ws-hidden-used', name: 'Hidden Used', hidden: true },
    { id: 'ws-hidden-orphan', name: 'Hidden Orphan', hidden: true },
  ],
  dashboards: [
    {
      id: 'dash-visible',
      name: 'Visible Dashboard',
      hidden: false,
      containedSheets: ['ws-visible', 'ws-hidden-used'],
    },
    {
      id: 'dash-hidden',
      name: 'Hidden Dashboard',
      hidden: true,
      containedSheets: ['ws-hidden-orphan'],
    },
  ],
};

const workbookXml = `<?xml version="1.0"?>
<workbook xmlns:user="http://tableau.com/xml/user">
  <worksheets>
    <worksheet name="Visible Sheet"><table/></worksheet>
    <worksheet name="Hidden Used"><table/></worksheet>
    <worksheet name="Hidden Orphan"><table/></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Visible Dashboard">
      <zones><zone name="Visible Sheet"/><zone name="Hidden Used"/></zones>
    </dashboard>
    <dashboard name="Hidden Dashboard">
      <zones><zone name="Hidden Orphan"/></zones>
    </dashboard>
  </dashboards>
</workbook>`;

describe('eligibleStyleArtifacts', () => {
  it('returns stable inventory ids for visible sheets and dashboards plus hidden dashboard dependencies', () => {
    expect(eligibleStyleArtifacts(inventory, workbookXml)).toEqual([
      { kind: 'worksheet', id: 'ws-visible', name: 'Visible Sheet', hidden: false },
      { kind: 'worksheet', id: 'ws-hidden-used', name: 'Hidden Used', hidden: true },
      { kind: 'dashboard', id: 'dash-visible', name: 'Visible Dashboard', hidden: false },
    ]);
  });

  it('accepts only XML text so every input passes strict malformed-XML detection', () => {
    expectTypeOf(eligibleStyleArtifacts).parameter(1).toEqualTypeOf<string>();
  });

  it('fails when an eligible inventory name is missing from workbook XML', () => {
    const missingSheet = workbookXml.replace(
      '<worksheet name="Visible Sheet"><table/></worksheet>',
      '',
    );

    expect(() => eligibleStyleArtifacts(inventory, missingSheet)).toThrow(
      'worksheet "Visible Sheet" (ws-visible) is missing from workbook XML',
    );
  });

  it('fails when an eligible inventory name is ambiguous in workbook XML', () => {
    const duplicateDashboard = workbookXml.replace(
      '</dashboards>',
      '<dashboard name="Visible Dashboard"/></dashboards>',
    );

    expect(() => eligibleStyleArtifacts(inventory, duplicateDashboard)).toThrow(
      'dashboard "Visible Dashboard" (dash-visible) matches 2 workbook XML elements',
    );
  });

  it('fails when a visible dashboard references an unknown worksheet id', () => {
    const inconsistentInventory: WorkbookInventory = {
      ...inventory,
      dashboards: [
        {
          id: 'dash-visible',
          name: 'Visible Dashboard',
          hidden: false,
          containedSheets: ['ws-visible', 'ws-not-in-inventory'],
        },
      ],
    };

    expect(() => eligibleStyleArtifacts(inconsistentInventory, workbookXml)).toThrow(
      'dashboard "Visible Dashboard" (dash-visible) references unknown worksheet id "ws-not-in-inventory"',
    );
  });

  it('fails when an inventory id is ambiguous before joining it to workbook XML', () => {
    const duplicateIdInventory: WorkbookInventory = {
      ...inventory,
      worksheets: [
        ...(inventory.worksheets ?? []),
        { id: 'ws-visible', name: 'Another Sheet', hidden: false },
      ],
    };

    expect(() => eligibleStyleArtifacts(duplicateIdInventory, workbookXml)).toThrow(
      'worksheet id "ws-visible" appears 2 times in workbook inventory',
    );
  });

  it('fails when two eligible inventory ids would join to the same XML name', () => {
    const duplicateNameInventory: WorkbookInventory = {
      ...inventory,
      worksheets: [
        ...(inventory.worksheets ?? []),
        { id: 'ws-other-visible', name: 'Visible Sheet', hidden: false },
      ],
    };

    expect(() => eligibleStyleArtifacts(duplicateNameInventory, workbookXml)).toThrow(
      'worksheet name "Visible Sheet" identifies 2 eligible workbook inventory entries',
    );
  });

  it.each([
    ['a missing distinct sheet', '<zone name="Hidden Used"/>', ''],
    [
      'an extra distinct sheet',
      '<zone name="Hidden Used"/>',
      '<zone name="Hidden Used"/><zone name="Hidden Orphan"/>',
    ],
  ])('fails when dashboard XML has %s', (_label, before, after) => {
    const staleDashboardXml = workbookXml.replace(before, after);

    expect(() => eligibleStyleArtifacts(inventory, staleDashboardXml)).toThrow(
      'dashboard "Visible Dashboard" (dash-visible) membership differs between inventory and workbook XML',
    );
  });

  it('uses XML zones when an older inventory omits contained sheet ids', () => {
    const inventoryWithoutContainedSheets: WorkbookInventory = {
      ...inventory,
      dashboards: [{ id: 'dash-visible', name: 'Visible Dashboard', hidden: false }],
    };

    expect(
      eligibleStyleArtifacts(inventoryWithoutContainedSheets, workbookXml).map(({ id }) => id),
    ).toEqual(['ws-visible', 'ws-hidden-used', 'dash-visible']);
  });

  it('excludes named type-v2 control zones while keeping primary worksheet zones', () => {
    const inventoryWithoutContainedSheets: WorkbookInventory = {
      ...inventory,
      dashboards: [{ id: 'dash-visible', name: 'Visible Dashboard', hidden: false }],
    };
    const xmlWithNamedControl = workbookXml.replace(
      '</zones>',
      '<zone name="Hidden Orphan" type-v2="color"/></zones>',
    );

    expect(
      eligibleStyleArtifacts(inventoryWithoutContainedSheets, xmlWithNamedControl).map(
        ({ id }) => id,
      ),
    ).toEqual(['ws-visible', 'ws-hidden-used', 'dash-visible']);
  });

  it('uses the existing unnamespaced worksheet-zone semantics', () => {
    const inventoryWithoutContainedSheets: WorkbookInventory = {
      ...inventory,
      dashboards: [{ id: 'dash-visible', name: 'Visible Dashboard', hidden: false }],
    };
    const xmlWithNamespacedZone = workbookXml.replace(
      '</zones>',
      '<user:zone name="Hidden Orphan"/></zones>',
    );

    expect(
      eligibleStyleArtifacts(inventoryWithoutContainedSheets, xmlWithNamespacedZone).map(
        ({ id }) => id,
      ),
    ).toEqual(['ws-visible', 'ws-hidden-used', 'dash-visible']);
  });

  it('accepts repeated identical worksheet membership across dashboard layout variants', () => {
    const liveShapedLayouts = workbookXml.replace(
      '<zones><zone name="Visible Sheet"/><zone name="Hidden Used"/></zones>',
      '<layouts><layout><zones><zone name="Visible Sheet"/><zone name="Hidden Used"/></zones></layout><layout><zones><zone name="Visible Sheet"/><zone name="Hidden Used"/></zones></layout></layouts>',
    );

    expect(eligibleStyleArtifacts(inventory, liveShapedLayouts)).toEqual([
      { kind: 'worksheet', id: 'ws-visible', name: 'Visible Sheet', hidden: false },
      { kind: 'worksheet', id: 'ws-hidden-used', name: 'Hidden Used', hidden: true },
      { kind: 'dashboard', id: 'dash-visible', name: 'Visible Dashboard', hidden: false },
    ]);
  });

  it('compares inventory and XML membership as normalized unique sets', () => {
    const duplicateMembershipInventory: WorkbookInventory = {
      ...inventory,
      dashboards: [
        {
          id: 'dash-visible',
          name: 'Visible Dashboard',
          hidden: false,
          containedSheets: ['ws-visible', 'ws-hidden-used', 'ws-hidden-used'],
        },
      ],
    };

    expect(
      eligibleStyleArtifacts(duplicateMembershipInventory, workbookXml).map(({ id }) => id),
    ).toEqual(['ws-visible', 'ws-hidden-used', 'dash-visible']);
  });

  it('fails closed on malformed eligibility XML', () => {
    expect(() => eligibleStyleArtifacts(inventory, '<workbook><worksheets></workbook>')).toThrow(
      'Cannot select style targets from malformed workbook XML',
    );
  });

  it('rejects xmldom warning recovery such as an unquoted attribute', () => {
    const warningXml = workbookXml.replace(
      '<workbook xmlns:user="http://tableau.com/xml/user">',
      '<workbook xmlns:user="http://tableau.com/xml/user" recovered=yes>',
    );

    expect(() => eligibleStyleArtifacts(inventory, warningXml)).toThrow(
      'Cannot select style targets from malformed workbook XML',
    );
  });

  it('does not join inventory worksheets against a namespaced collection', () => {
    const namespacedCollection = workbookXml
      .replace('<worksheets>', '<ext:worksheets xmlns:ext="urn:tableau:test">')
      .replace('</worksheets>', '</ext:worksheets>');

    expect(() => eligibleStyleArtifacts(inventory, namespacedCollection)).toThrow(
      'worksheet "Visible Sheet" (ws-visible) is missing from workbook XML',
    );
  });

  it('fails when older-inventory zone fallback finds no normalized worksheet name', () => {
    const inventoryWithoutContainedSheets: WorkbookInventory = {
      ...inventory,
      dashboards: [{ id: 'dash-visible', name: 'Visible Dashboard', hidden: false }],
    };
    const xmlWithMissingZoneTarget = workbookXml.replace(
      '<zone name="Hidden Used"/>',
      '<zone name="Missing Sheet"/>',
    );

    expect(() =>
      eligibleStyleArtifacts(inventoryWithoutContainedSheets, xmlWithMissingZoneTarget),
    ).toThrow(
      'dashboard "Visible Dashboard" (dash-visible) references worksheet name "Missing Sheet" which matches 0 workbook inventory entries',
    );
  });

  it('fails when older-inventory zone fallback finds ambiguous normalized worksheet names', () => {
    const ambiguousInventory: WorkbookInventory = {
      ...inventory,
      worksheets: [
        ...(inventory.worksheets ?? []),
        { id: 'ws-hidden-duplicate', name: ' Hidden Used ', hidden: true },
      ],
      dashboards: [{ id: 'dash-visible', name: 'Visible Dashboard', hidden: false }],
    };

    expect(() => eligibleStyleArtifacts(ambiguousInventory, workbookXml)).toThrow(
      'dashboard "Visible Dashboard" (dash-visible) references worksheet name "Hidden Used" which matches 2 workbook inventory entries',
    );
  });

  it('does not decode an entity-looking literal that inventory already decoded', () => {
    const literalInventory: WorkbookInventory = {
      title: 'Book 1',
      unsavedChanges: false,
      worksheets: [{ id: 'ws-literal', name: 'A &lt; B', hidden: false }],
      dashboards: [],
    };
    const xmlForLessThan =
      '<workbook><worksheets><worksheet name="A &lt; B"/></worksheets><dashboards/></workbook>';

    expect(() => eligibleStyleArtifacts(literalInventory, xmlForLessThan)).toThrow(
      'worksheet "A &lt; B" (ws-literal) is missing from workbook XML',
    );
  });

  it('joins an entity-looking literal only when XML encodes the literal ampersand', () => {
    const literalInventory: WorkbookInventory = {
      title: 'Book 1',
      unsavedChanges: false,
      worksheets: [{ id: 'ws-literal', name: 'A &lt; B', hidden: false }],
      dashboards: [],
    };
    const xmlForEntityLiteral =
      '<workbook><worksheets><worksheet name="A &amp;lt; B"/></worksheets><dashboards/></workbook>';

    expect(eligibleStyleArtifacts(literalInventory, xmlForEntityLiteral)).toEqual([
      { kind: 'worksheet', id: 'ws-literal', name: 'A &lt; B', hidden: false },
    ]);
  });
});
