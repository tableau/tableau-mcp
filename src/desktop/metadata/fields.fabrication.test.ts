import { listAvailableFields } from './field-builder.js';
import { type FieldRewriteEvent, setFieldRewriteListener } from './field-rewrite-listener.js';
import { addFieldToCols } from './fields.js';
import { normalizeArray, parseXML } from './parser.js';

// [Order Date] is a plain, never-customized field: Tableau records it only under
// <connection><metadata-records>, with no <column> element. listAvailableFields
// advertises exactly this ref, so add-field must resolve it from the same place.
// [Profit] carries an explicit <column> and is the control.
const WORKBOOK = `<?xml version='1.0' encoding='utf-8' ?>
<workbook version='18.1'>
  <datasources>
    <datasource name='Sample - Superstore' caption='Sample - Superstore'>
      <connection class='federated'>
        <metadata-records>
          <metadata-record class='column'>
            <remote-name>Order Date</remote-name>
            <local-name>[Order Date]</local-name>
            <local-type>date</local-type>
          </metadata-record>
        </metadata-records>
      </connection>
      <column name='[Profit]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='Sheet 1'>
      <table>
        <view>
          <datasources>
            <datasource name='Sample - Superstore' caption='Sample - Superstore' />
          </datasources>
          <datasource-dependencies datasource='Sample - Superstore' />
        </view>
        <rows />
        <cols />
      </table>
    </worksheet>
  </worksheets>
</workbook>`;

function declaredColumn(xml: string, name: string): any {
  const parsed = parseXML(xml);
  const ws = normalizeArray(parsed.workbook?.worksheets?.worksheet)[0];
  const deps = normalizeArray(ws?.table?.view?.['datasource-dependencies']);
  for (const dep of deps) {
    const hit = normalizeArray(dep.column).find((c: any) => c['@_name'] === name);
    if (hit) return hit;
  }
  return undefined;
}

describe('metadata/fields — never fabricate a column that exists', () => {
  let events: FieldRewriteEvent[] = [];
  const capture = (): void => {
    events = [];
    setFieldRewriteListener((e) => events.push(e));
  };
  afterEach(() => setFieldRewriteListener(null));

  it('resolves a field declared only in <metadata-records> instead of fabricating it', () => {
    capture();
    const out = addFieldToCols(
      WORKBOOK,
      '[Sample - Superstore].[mn:Order Date:nk]',
      undefined,
      WORKBOOK,
    );

    expect(events.filter((e) => e.fabricated)).toEqual([]);

    // The real datatype must survive. Fabrication guessed 'string' from the
    // derivation prefix, which binds a date to a string axis.
    const col = declaredColumn(out, '[Order Date]');
    expect(col).toBeDefined();
    expect(col['@_datatype']).toBe('date');
  });

  it('refuses a field the workbook proves absent rather than inventing one', () => {
    capture();
    expect(() =>
      addFieldToCols(
        WORKBOOK,
        '[Sample - Superstore].[sum:Nonexistent Field:qk]',
        undefined,
        WORKBOOK,
      ),
    ).toThrow(/does not exist in datasource/);
    expect(events.filter((e) => e.fabricated)).toEqual([]);
  });

  it('still falls back, flagged, when no workbook is supplied to verify against', () => {
    capture();
    const out = addFieldToCols(WORKBOOK, '[Sample - Superstore].[sum:Unverifiable:qk]');
    expect(out).toContain('Unverifiable');
    expect(events.filter((e) => e.fabricated)).toHaveLength(1);
  });

  it('still falls back, flagged, when the datasource key does not match the workbook', () => {
    capture();
    const out = addFieldToCols(
      WORKBOOK,
      '[federated.some-other-key].[sum:Sales:qk]',
      undefined,
      WORKBOOK,
    );
    expect(out).toContain('Sales');
    expect(events.filter((e) => e.fabricated)).toHaveLength(1);
  });

  it('leaves an explicitly declared <column> resolving as before', () => {
    capture();
    const out = addFieldToCols(
      WORKBOOK,
      '[Sample - Superstore].[sum:Profit:qk]',
      undefined,
      WORKBOOK,
    );
    expect(events.filter((e) => e.fabricated)).toEqual([]);
    expect(declaredColumn(out, '[Profit]')['@_datatype']).toBe('real');
  });
});

function worksheetShell(datasource: string): string {
  return `<worksheets>
    <worksheet name='Sheet 1'>
      <table>
        <view>
          <datasources><datasource name='${datasource}' /></datasources>
          <datasource-dependencies datasource='${datasource}' />
        </view>
        <rows />
        <cols />
      </table>
    </worksheet>
  </worksheets>`;
}

// A join of joins: Tableau nests <relation type='join'> inside another join and
// only the leaf <relation type='table'> carries <columns>. [Amount] and
// [Return Reason] sit two levels down; [Regional Manager] sits one level down.
const JOIN_OF_JOINS = `<?xml version='1.0' encoding='utf-8' ?>
<workbook version='18.1'>
  <datasources>
    <datasource name='federated.joins' caption='Joined'>
      <connection class='federated'>
        <relation type='join' name='outer'>
          <relation type='join' name='inner'>
            <relation type='table' name='Orders'>
              <columns>
                <column name='Amount' datatype='real' />
              </columns>
            </relation>
            <relation type='table' name='Returns'>
              <columns>
                <column name='Return Reason' datatype='string' />
              </columns>
            </relation>
          </relation>
          <relation type='table' name='People'>
            <columns>
              <column name='Regional Manager' datatype='string' />
            </columns>
          </relation>
        </relation>
      </connection>
    </datasource>
  </datasources>
  ${worksheetShell('federated.joins')}
</workbook>`;

describe('metadata/fields — relation columns at any nesting depth', () => {
  let events: FieldRewriteEvent[] = [];
  const capture = (): void => {
    events = [];
    setFieldRewriteListener((e) => events.push(e));
  };
  afterEach(() => setFieldRewriteListener(null));

  it('advertises leaf columns nested two joins deep', () => {
    const names = listAvailableFields(JOIN_OF_JOINS).map((f) => f.columnName);
    expect(names).toContain('[Amount]');
    expect(names).toContain('[Return Reason]');
    expect(names).toContain('[Regional Manager]');
  });

  it('resolves a leaf column nested two joins deep instead of hard-failing', () => {
    capture();
    const out = addFieldToCols(
      JOIN_OF_JOINS,
      '[federated.joins].[sum:Amount:qk]',
      undefined,
      JOIN_OF_JOINS,
    );

    expect(events.filter((e) => e.fabricated)).toEqual([]);
    const col = declaredColumn(out, '[Amount]');
    expect(col).toBeDefined();
    expect(col['@_datatype']).toBe('real');
    expect(col['@_role']).toBe('measure');
  });

  it('resolves every field it advertises from a join of joins', () => {
    for (const field of listAvailableFields(JOIN_OF_JOINS)) {
      expect(() =>
        addFieldToCols(JOIN_OF_JOINS, field.column_ref, undefined, JOIN_OF_JOINS),
      ).not.toThrow();
    }
  });
});

// [Order Date] is declared twice with different types: the relation column says
// datetime, the metadata record says date. [Quantity]'s metadata record carries
// no <local-type> at all, so only the relation column knows it is an integer.
const CONFLICTING_TYPES = `<?xml version='1.0' encoding='utf-8' ?>
<workbook version='18.1'>
  <datasources>
    <datasource name='federated.conflict' caption='Conflict'>
      <connection class='federated'>
        <relation type='table' name='Orders'>
          <columns>
            <column name='Order Date' datatype='datetime' />
            <column name='Quantity' datatype='integer' />
          </columns>
        </relation>
        <metadata-records>
          <metadata-record class='column'>
            <remote-name>Order Date</remote-name>
            <local-name>[Order Date]</local-name>
            <local-type>date</local-type>
          </metadata-record>
          <metadata-record class='column'>
            <remote-name>Quantity</remote-name>
            <local-name>[Quantity]</local-name>
          </metadata-record>
          <metadata-record class='column'>
            <remote-name>Notes</remote-name>
            <local-name>[Notes]</local-name>
          </metadata-record>
        </metadata-records>
      </connection>
    </datasource>
  </datasources>
  ${worksheetShell('federated.conflict')}
</workbook>`;

describe('metadata/fields — writer datatype agrees with what the reader advertised', () => {
  const advertised = (name: string): ReturnType<typeof listAvailableFields>[number] =>
    listAvailableFields(CONFLICTING_TYPES).find((f) => f.columnName === name)!;

  it('writes the relation datatype when a metadata record disagrees', () => {
    const reader = advertised('[Order Date]');
    expect(reader.datatype).toBe('datetime');

    const out = addFieldToCols(CONFLICTING_TYPES, reader.column_ref, undefined, CONFLICTING_TYPES);
    expect(declaredColumn(out, '[Order Date]')['@_datatype']).toBe(reader.datatype);
  });

  it('does not let a metadata record with no local-type flatten a typed column to string', () => {
    const reader = advertised('[Quantity]');
    expect(reader.datatype).toBe('integer');

    const out = addFieldToCols(CONFLICTING_TYPES, reader.column_ref, undefined, CONFLICTING_TYPES);
    const col = declaredColumn(out, '[Quantity]');
    expect(col['@_datatype']).toBe('integer');
    expect(col['@_role']).toBe('measure');
  });

  it('still resolves a typeless metadata record no other source describes', () => {
    const reader = advertised('[Notes]');
    expect(() =>
      addFieldToCols(CONFLICTING_TYPES, reader.column_ref, undefined, CONFLICTING_TYPES),
    ).not.toThrow();
  });
});
