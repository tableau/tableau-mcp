import {
  deriveTargetWorksheetWindowState,
  deriveWorksheetApplyState,
  worksheetApplyStateSchema,
} from './targetWorksheetState.js';

const worksheetXml = `
  <worksheet name="Target">
    <table>
      <view>
        <datasources><datasource name="Orders" /></datasources>
        <datasource-dependencies datasource="Orders">
          <column name="[Sales]" role="measure" type="quantitative" datatype="real" />
          <column-instance name="[sum:Sales:qk]" column="[Sales]" derivation="Sum" type="quantitative" pivot="key" />
        </datasource-dependencies>
      </view>
      <panes><pane><encodings><color column="[Orders].[sum:Sales:qk]" /></encodings></pane></panes>
      <rows>[Orders].[sum:Sales:qk]</rows>
    </table>
  </worksheet>`;

const field = (
  name: string,
  {
    role = 'measure',
    type = 'quantitative',
    datatype = 'real',
    semanticRole,
    calculation,
  }: {
    role?: string;
    type?: string;
    datatype?: string;
    semanticRole?: string;
    calculation?: string;
  } = {},
): string =>
  `<column name="[${name}]" role="${role}" type="${type}" datatype="${datatype}"${
    semanticRole ? ` semantic-role="${semanticRole}"` : ''
  }>${calculation ?? ''}</column>`;

const workbook = ({
  targetTable = '<rows />',
  targetWindow = '<cards><card type="filters" /></cards>',
  ordersFields = field('Sales'),
  otherFields = field('Other'),
  ordersConnection = '<connection class="textscan"><relation name="orders.csv" /></connection>',
}: {
  targetTable?: string;
  targetWindow?: string;
  ordersFields?: string;
  otherFields?: string;
  ordersConnection?: string;
} = {}): string => `
  <workbook>
    <datasources>
      <datasource name="Orders" caption="Orders">${ordersFields}${ordersConnection}</datasource>
      <datasource name="Other DS">${otherFields}</datasource>
    </datasources>
    <worksheets>
      <worksheet name="Target"><table>${targetTable}</table></worksheet>
      <worksheet name="Sibling"><table><cols /></table></worksheet>
    </worksheets>
    <windows>
      <window class="worksheet" name="Target">${targetWindow}</window>
      <window class="worksheet" name="Sibling"><cards /></window>
    </windows>
  </workbook>`;

const worksheetWindowXml =
  '<window class="worksheet" name="Target"><cards><card type="template" /></cards></window>';

describe('worksheet apply state', () => {
  it('binds the target worksheet state and referenced field definitions', () => {
    const state = deriveWorksheetApplyState(workbook(), 'Target', worksheetXml, worksheetWindowXml);

    expect(state).toEqual({
      target: { state: 'present', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      targetWindow: { state: 'present', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      dependenciesSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      artifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(
      deriveWorksheetApplyState(workbook(), 'Target', worksheetXml, worksheetWindowXml),
    ).toEqual(state);
  });

  it('returns an absent target while still binding referenced fields', () => {
    const state = deriveWorksheetApplyState(workbook(), 'Missing', worksheetXml);

    expect(state.target).toEqual({ state: 'absent' });
    expect(state.targetWindow).toEqual({ state: 'absent' });
    expect(state.dependenciesSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(state.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds the exact worksheet and window artifact that the user confirmed', () => {
    const initial = deriveWorksheetApplyState(
      workbook(),
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );
    const worksheetChanged = deriveWorksheetApplyState(
      workbook(),
      'Target',
      worksheetXml.replace('<rows>', '<cols>').replace('</rows>', '</cols>'),
      worksheetWindowXml,
    );
    const windowChanged = deriveWorksheetApplyState(
      workbook(),
      'Target',
      worksheetXml,
      worksheetWindowXml.replace('type="template"', 'type="marks"'),
    );

    expect(worksheetChanged.artifactSha256).not.toBe(initial.artifactSha256);
    expect(windowChanged.artifactSha256).not.toBe(initial.artifactSha256);
  });

  it('guards the matching worksheet window without binding unrelated windows', () => {
    const initial = deriveWorksheetApplyState(
      workbook(),
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );
    const targetWindowChanged = deriveWorksheetApplyState(
      workbook({ targetWindow: '<cards><card type="marks" /></cards>' }),
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );
    const siblingWindowChanged = deriveWorksheetApplyState(
      workbook().replace(
        '<window class="worksheet" name="Sibling"><cards /></window>',
        '<window class="worksheet" name="Sibling"><cards><card type="pages" /></cards></window>',
      ),
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );

    expect(targetWindowChanged.targetWindow).not.toEqual(initial.targetWindow);
    expect(siblingWindowChanged).toEqual(initial);
  });

  it('guards every matching worksheet window that apply will replace or remove', () => {
    const duplicateWindows = workbook().replace(
      '</windows>',
      '<window class="worksheet" name="Target"><cards><duplicate-card /></cards></window></windows>',
    );
    const changedDuplicate = duplicateWindows.replace('<duplicate-card />', '<changed-card />');

    const initial = deriveWorksheetApplyState(
      duplicateWindows,
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );
    const changed = deriveWorksheetApplyState(
      changedDuplicate,
      'Target',
      worksheetXml,
      worksheetWindowXml,
    );

    expect(changed.targetWindow).not.toEqual(initial.targetWindow);
  });

  it('ignores equivalent worksheet-window attribute, element, and formatting order', () => {
    const windowWorkbook = (windowXml: string, userUri = 'urn:user'): string => `
      <workbook xmlns:user="${userUri}">
        <windows>${windowXml}</windows>
      </workbook>`;
    const before = deriveTargetWorksheetWindowState(
      windowWorkbook(`
        <window class="worksheet" name="Target" maximized="true">
          <cards><card type="filters" user:mode="compact" /></cards>
          <viewpoints><viewpoint name="Target" /></viewpoints>
        </window>`),
      'Target',
    );
    const normalized = deriveTargetWorksheetWindowState(
      windowWorkbook(
        '<window maximized="true" name="Target" class="worksheet"><viewpoints><viewpoint name="Target"/></viewpoints><cards><card user:mode="compact" type="filters"/></cards></window>',
      ),
      'Target',
    );
    const namespaceChanged = deriveTargetWorksheetWindowState(
      windowWorkbook(
        '<window class="worksheet" name="Target" maximized="true"><cards><card type="filters" user:mode="compact" /></cards><viewpoints><viewpoint name="Target" /></viewpoints></window>',
        'urn:other-user',
      ),
      'Target',
    );

    expect(normalized).toEqual(before);
    expect(namespaceChanged).not.toEqual(before);
  });

  it('matches NFC-equivalent worksheet and worksheet-window names', () => {
    const composed = 'Caf\u00e9';
    const decomposed = 'Cafe\u0301';
    const namedWorkbook = workbook().replaceAll('name="Target"', `name="${composed}"`);

    const state = deriveWorksheetApplyState(
      namedWorkbook,
      decomposed,
      worksheetXml.replace('name="Target"', `name="${decomposed}"`),
      worksheetWindowXml.replace('name="Target"', `name="${decomposed}"`),
    );

    expect(state.target.state).toBe('present');
    expect(state.targetWindow.state).toBe('present');
  });

  it.each([
    ['role', field('Sales', { role: 'dimension' })],
    ['type', field('Sales', { type: 'ordinal' })],
    ['datatype', field('Sales', { datatype: 'integer' })],
    ['semantic role', field('Sales', { semanticRole: '[Country].[Name]' })],
    [
      'calculation',
      field('Sales', {
        calculation: '<calculation class="tableau" formula="SUM([Profit])" />',
      }),
    ],
    [
      'group definition',
      field('Sales', {
        role: 'dimension',
        type: 'nominal',
        datatype: 'string',
        calculation:
          '<calculation class="categorical-bin" column="[Category]"><bin value="A"><value>Alpha</value></bin></calculation>',
      }),
    ],
  ])('changes when the referenced field %s changes', (_label, changedField) => {
    const before = deriveWorksheetApplyState(workbook(), 'Target', worksheetXml);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: changedField }),
      'Target',
      worksheetXml,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('changes when a referenced field is removed', () => {
    const before = deriveWorksheetApplyState(workbook(), 'Target', worksheetXml);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: field('Profit') }),
      'Target',
      worksheetXml,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('ignores unrelated fields, datasources, connections, and values', () => {
    const before = deriveWorksheetApplyState(workbook(), 'Target', worksheetXml);
    const after = deriveWorksheetApplyState(
      workbook({
        ordersFields: `${field('Sales')}${field('Unused', { datatype: 'string' })}`,
        otherFields: field('Other', { role: 'dimension', datatype: 'date' }),
        ordersConnection:
          '<connection class="sqlserver"><relation name="renamed"><rows><row value="changed" /></rows></relation></connection>',
      }),
      'Target',
      worksheetXml,
    );

    expect(after.dependenciesSha256).toBe(before.dependenciesSha256);
  });

  it('ignores an unused field definition carried in datasource-dependencies', () => {
    const incomingWithUnusedDefinition = worksheetXml.replace(
      '</datasource-dependencies>',
      `${field('Unused', { datatype: 'string' })}</datasource-dependencies>`,
    );
    const before = deriveWorksheetApplyState(
      workbook({ ordersFields: `${field('Sales')}${field('Unused', { datatype: 'string' })}` }),
      'Target',
      incomingWithUnusedDefinition,
    );
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: `${field('Sales')}${field('Unused', { datatype: 'date' })}` }),
      'Target',
      incomingWithUnusedDefinition,
    );

    expect(after.dependenciesSha256).toBe(before.dependenciesSha256);
  });

  it('tracks a filter-only bare field reference through its dependencies declaration', () => {
    const filterOnly = `
      <worksheet name="Target">
        <table>
          <view>
            <datasource-dependencies datasource="Orders">
              <column name="[Sales]" role="measure" type="quantitative" datatype="real" />
            </datasource-dependencies>
            <filter column="[Sales]" />
          </view>
        </table>
      </worksheet>`;
    const before = deriveWorksheetApplyState(workbook(), 'Target', filterOnly);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: field('Sales', { datatype: 'integer' }) }),
      'Target',
      filterOnly,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('derives dependencies from qualified references when there is no dependencies block', () => {
    const noDependencies = `
      <worksheet name="Target">
        <table><rows>[Orders].[sum:Sales:qk]</rows></table>
      </worksheet>`;
    const before = deriveWorksheetApplyState(workbook(), 'Target', noDependencies);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: field('Sales', { datatype: 'integer' }) }),
      'Target',
      noDependencies,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('resolves a compound table-calc instance when there is no dependencies block', () => {
    const noDependencies = `
      <worksheet name="Target">
        <table><rows>[Orders].[cum:sum:Sales:qk]</rows></table>
      </worksheet>`;
    const before = deriveWorksheetApplyState(workbook(), 'Target', noDependencies);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: field('Sales', { datatype: 'integer' }) }),
      'Target',
      noDependencies,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('resolves a compound shelf instance through its declared underlying instance', () => {
    const compoundWorksheet = worksheetXml.replaceAll(
      '[Orders].[sum:Sales:qk]',
      '[Orders].[pcto:sum:Sales:qk]',
    );

    const before = deriveWorksheetApplyState(workbook(), 'Target', compoundWorksheet);
    const after = deriveWorksheetApplyState(
      workbook({ ordersFields: field('Sales', { datatype: 'integer' }) }),
      'Target',
      compoundWorksheet,
    );

    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('resolves Tableau doubled-bracket escapes in datasource and field names', () => {
    const escapedWorksheet = `
      <worksheet name="Target">
        <table><rows>[Orders]] Archive].[sum:Net]] Sales:qk]</rows></table>
      </worksheet>`;
    const escapedWorkbook = (datatype: string): string => `
      <workbook>
        <datasources>
          <datasource name="Orders] Archive">
            <column name="[Net]] Sales]" role="measure" type="quantitative" datatype="${datatype}" />
          </datasource>
        </datasources>
        <worksheets><worksheet name="Target"><table /></worksheet></worksheets>
      </workbook>`;

    const before = deriveWorksheetApplyState(escapedWorkbook('real'), 'Target', escapedWorksheet);
    const after = deriveWorksheetApplyState(escapedWorkbook('integer'), 'Target', escapedWorksheet);
    expect(after.dependenciesSha256).not.toBe(before.dependenciesSha256);
  });

  it('uses stable raw-field schema when a field exists only in connection metadata', () => {
    const rawWorkbook = (datatype: string, relationName: string): string => `
      <workbook>
        <datasources>
          <datasource name="Orders">
            <connection class="textscan">
              <relation name="${relationName}"><columns><column name="Sales" datatype="${datatype}" /></columns></relation>
            </connection>
          </datasource>
        </datasources>
        <worksheets><worksheet name="Target"><table /></worksheet></worksheets>
      </workbook>`;
    const noDependencies = `
      <worksheet name="Target"><table><rows>[Orders].[sum:Sales:qk]</rows></table></worksheet>`;

    const initial = deriveWorksheetApplyState(
      rawWorkbook('real', 'orders.csv'),
      'Target',
      noDependencies,
    );
    const connectionOnly = deriveWorksheetApplyState(
      rawWorkbook('real', 'renamed.csv'),
      'Target',
      noDependencies,
    );
    const schemaChanged = deriveWorksheetApplyState(
      rawWorkbook('integer', 'orders.csv'),
      'Target',
      noDependencies,
    );

    expect(connectionOnly.dependenciesSha256).toBe(initial.dependenciesSha256);
    expect(schemaChanged.dependenciesSha256).not.toBe(initial.dependenciesSha256);
  });

  it('fails closed on an unterminated qualified field reference', () => {
    const malformed = `
      <worksheet name="Target"><table><rows>[Orders].[sum:Sales:qk</rows></table></worksheet>`;

    expect(() => deriveWorksheetApplyState(workbook(), 'Target', malformed)).toThrow(
      /Malformed datasource-qualified field reference/,
    );
  });

  it('tracks a formula input field transitively', () => {
    const calcWorksheet = worksheetXml
      .replaceAll('[Sales]', '[Margin]')
      .replaceAll('sum:Sales:qk', 'usr:Margin:qk');
    const calc = field('Margin', {
      calculation: '<calculation class="tableau" formula="[Sales] / [Profit]" />',
    });
    const beforeWorkbook = workbook({
      ordersFields: `${field('Sales')}${field('Profit')}${calc}`,
    });
    const changedWorkbook = workbook({
      ordersFields: `${field('Sales')}${field('Profit', { datatype: 'integer' })}${calc}`,
    });

    expect(
      deriveWorksheetApplyState(changedWorkbook, 'Target', calcWorksheet).dependenciesSha256,
    ).not.toBe(
      deriveWorksheetApplyState(beforeWorkbook, 'Target', calcWorksheet).dependenciesSha256,
    );
  });

  it('changes the target fingerprint only when the target worksheet changes', () => {
    const initial = deriveWorksheetApplyState(workbook(), 'Target', worksheetXml);
    const siblingChanged = deriveWorksheetApplyState(
      workbook().replace('<cols />', '<cols><column /></cols>'),
      'Target',
      worksheetXml,
    );
    const targetChanged = deriveWorksheetApplyState(
      workbook({ targetTable: '<rows><row /></rows>' }),
      'Target',
      worksheetXml,
    );

    expect(siblingChanged).toEqual(initial);
    expect(targetChanged.target).not.toEqual(initial.target);
    expect(targetChanged.dependenciesSha256).toBe(initial.dependenciesSha256);
  });

  it('carries namespace declarations from both workbook and worksheets ancestors', () => {
    const namespaced = (userUri: string, mapUri: string): string => `
      <workbook xmlns:user="${userUri}">
        <worksheets xmlns:map="${mapUri}">
          <worksheet name="Target">
            <table><groupfilter user:ui-enumeration="all"><map:encoding /></groupfilter></table>
          </worksheet>
        </worksheets>
      </workbook>`;

    const initial = deriveWorksheetApplyState(
      namespaced('urn:user:1', 'urn:map:1'),
      'Target',
      worksheetXml,
    );
    const rootChanged = deriveWorksheetApplyState(
      namespaced('urn:user:2', 'urn:map:1'),
      'Target',
      worksheetXml,
    );
    const worksheetsChanged = deriveWorksheetApplyState(
      namespaced('urn:user:1', 'urn:map:2'),
      'Target',
      worksheetXml,
    );

    expect(rootChanged.target).not.toEqual(initial.target);
    expect(worksheetsChanged.target).not.toEqual(initial.target);
  });

  it('strictly validates the public JSON contract', () => {
    const valid = {
      target: { state: 'present', sha256: 'a'.repeat(64) },
      targetWindow: { state: 'present', sha256: 'b'.repeat(64) },
      dependenciesSha256: 'c'.repeat(64),
      artifactSha256: 'd'.repeat(64),
    };
    expect(worksheetApplyStateSchema.parse(valid)).toEqual(valid);
    expect(() =>
      worksheetApplyStateSchema.parse({ ...valid, dependenciesSha256: 'B'.repeat(64) }),
    ).toThrow();
    expect(() => worksheetApplyStateSchema.parse({ ...valid, extra: true })).toThrow();
    expect(() =>
      worksheetApplyStateSchema.parse({
        ...valid,
        target: { state: 'absent', sha256: 'a'.repeat(64) },
      }),
    ).toThrow();
  });
});
