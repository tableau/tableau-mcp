import { readFileSync } from 'fs';
import { join } from 'path';

import { listAvailableFields } from './field-builder.js';
import { type DataModelDatasource, describeDataModel } from './objectModel.js';

const REPO = join(__dirname, '..', '..', '..');
const FIXTURES = join(__dirname, '__fixtures__', 'object-model');
const SUPERSTORE = join(
  REPO,
  'src/tools/desktop/authoring/datasource/__fixtures__/real-superstore-document.twb.xml',
);
const PUBLISHED = join(REPO, 'tests/e2e/fixtures/workbooks/superstore-datasource.twb');

const ORDERS = 'Orders_ECFCA1FB690A41FE803BC071773BA862';
const PEOPLE = 'People_D73023733B004CC1B3CB1ACF62F4A965';
const RETURNS = 'Returns_2AA0FE4D737A4F63970131D0E7480A03';

const read = (path: string): string => readFileSync(path, 'utf8');
const fixture = (name: string): string => read(join(FIXTURES, name));

function only(xml: string): DataModelDatasource {
  const { datasources } = describeDataModel(xml);
  expect(datasources).toHaveLength(1);
  return datasources[0];
}

function named(xml: string, name: string): DataModelDatasource {
  const datasource = describeDataModel(xml).datasources.find((d) => d.name === name);
  expect(datasource).toBeDefined();
  return datasource!;
}

const kinds = (ds: DataModelDatasource): string[] => ds.problems.map((p) => p.kind);

const facts = (
  ds: DataModelDatasource,
): Array<[string | undefined, number | undefined, number | undefined, number]> =>
  ds.tables.map((t) => [t.caption, t.measures, t.dimensions, t.relationships]);

const FACTS_SUPERSTORE: ReturnType<typeof facts> = [
  ['Orders', 4, 14, 2],
  ['People', 0, 1, 1],
  ['Returns', 0, 1, 1],
];
const FACTS_PUBLISHED: ReturnType<typeof facts> = [
  ['Orders', 5, 18, 2],
  ['People', 0, 2, 1],
  ['Returns', 0, 2, 1],
];
const FACTS_EXPLICIT: ReturnType<typeof facts> = [
  ['Orders', 1, 0, 2],
  ['People', 0, 1, 1],
  ['Returns', 0, 0, 1],
];
const FACTS_SNOWFLAKE: ReturnType<typeof facts> = [
  ['Orders', 2, 0, 1],
  ['Products', 0, 1, 2],
  ['Category', 0, 1, 1],
];

describe('describeDataModel', () => {
  describe('real relationships (real-superstore-document.twb.xml)', () => {
    const ds = only(read(SUPERSTORE));

    it('reads three logical tables with captions and physical leaves', () => {
      expect(ds.tables.map((t) => [t.id, t.caption, t.isLegacy])).toEqual([
        [ORDERS, 'Orders', false],
        [PEOPLE, 'People', false],
        [RETURNS, 'Returns', false],
      ]);
      expect(ds.tables[0].physical).toEqual({
        type: 'table',
        name: 'Orders',
        table: '[Orders$]',
        connection: 'excel-direct.0ozsbj20cdelf51evvdk71kugqg0',
        children: [],
      });
    });

    it('reads two relationships with their field pairs', () => {
      expect(
        ds.relationships.map((r) => ({
          fromTableId: r.fromTableId,
          toTableId: r.toTableId,
          operator: r.operator,
          fields: r.fields,
        })),
      ).toEqual([
        {
          fromTableId: ORDERS,
          toTableId: PEOPLE,
          operator: '=',
          fields: [{ operator: '=', fromField: '[Region]', toField: '[Region (People)]' }],
        },
        {
          fromTableId: ORDERS,
          toTableId: RETURNS,
          operator: '=',
          fields: [{ operator: '=', fromField: '[Order ID]', toField: '[Order ID (Returns)]' }],
        },
      ]);
      for (const r of ds.relationships) {
        expect(r.from).toEqual({ tableId: r.fromTableId, cardinality: 'not-set' });
        expect(r.to).toEqual({ tableId: r.toTableId, cardinality: 'not-set' });
      }
    });

    it("flags both relationships many-to-many as Tableau's unset default", () => {
      expect(kinds(ds)).toEqual(['many-to-many', 'many-to-many']);
      expect(ds.problems.map((p) => p.relationship)).toEqual([0, 1]);
      for (const problem of ds.problems) {
        expect(problem.message).toContain('not set (Tableau default)');
        expect(problem.message).toContain('some records match');
      }
    });

    it('counts measures, dimensions and relationships per table without labelling a role', () => {
      expect(facts(ds)).toEqual(FACTS_SUPERSTORE);
      expect(ds.tables[0]).not.toHaveProperty('guess');
    });

    it('counts the 9 visible fields tied to no table: 7 measures, 2 dimensions', () => {
      expect(ds.untiedFields).toEqual({ measures: 7, dimensions: 2 });
    });

    it('reports no orphan, duplicate or dangling end point', () => {
      expect(kinds(ds)).not.toContain('orphan-table');
      expect(kinds(ds)).not.toContain('duplicate-table');
      expect(kinds(ds)).not.toContain('dangling-endpoint');
    });
  });

  describe('published datasource (superstore-datasource.twb)', () => {
    const xml = read(PUBLISHED);
    const ds = only(xml);

    it('reads one object graph and ignores the copy inside the CDATA attribute', () => {
      // The CDATA copy at :4794 would add a second set of three tables and two relationships.
      expect(xml.match(/<object-graph>/g)).toHaveLength(2);
      expect(ds.tables.map((t) => t.caption)).toEqual(['Orders', 'People', 'Returns']);
      expect(ds.relationships).toHaveLength(2);
    });

    it('raises no duplicate-table for the shared [sqlproxy] leaf', () => {
      expect(ds.tables.map((t) => t.physical?.table)).toEqual([
        '[sqlproxy]',
        '[sqlproxy]',
        '[sqlproxy]',
      ]);
      expect(kinds(ds)).not.toContain('duplicate-table');
    });

    it('uses field ownership from its metadata-record object-ids', () => {
      // This fixture does carry <object-id> records, so ownership is known here.
      expect(facts(ds)).toEqual(FACTS_PUBLISHED);
    });
  });

  it('says field ownership is unknown when no field carries a logical table id', () => {
    const xml = read(PUBLISHED).replace(/<object-id>\[[^\]]+\]<\/object-id>/g, '');
    expect(listAvailableFields(xml).every((f) => f.logicalTableId === undefined)).toBe(true);

    const ds = only(xml);
    expect(facts(ds).map(([, m, d, r]) => [m, d, r])).toEqual([
      [undefined, undefined, 2],
      [undefined, undefined, 1],
      [undefined, undefined, 1],
    ]);
    expect(ds.untiedFields).toBeUndefined();
  });

  it('omits untiedFields for a graphless legacy datasource', () => {
    const xml = `<workbook><datasources><datasource caption='Legacy' name='federated.legacy1'>
      <connection class='federated'><relation name='Orders' table='[Orders$]' type='table'/>
        <metadata-records>
          <metadata-record class='column'><local-name>[Region]</local-name><parent-name>[Orders]</parent-name><local-type>string</local-type></metadata-record>
          <metadata-record class='column'><local-name>[Sales]</local-name><parent-name>[Orders]</parent-name><local-type>real</local-type></metadata-record>
        </metadata-records></connection>
      <column datatype='real' name='[Sales]' role='measure' type='quantitative'/>
    </datasource></datasources></workbook>`;
    expect(listAvailableFields(xml).length).toBeGreaterThan(0);
    expect(only(xml).untiedFields).toBeUndefined();
  });

  it('reads a single extract table, ignores the extract context and flags nothing', () => {
    const ds = only(fixture('single-table-extract.xml'));
    expect(ds.tables).toHaveLength(1);
    expect(ds.tables[0].physical).toEqual({
      type: 'table',
      name: 'Extract',
      table: '[Extract].[Extract]',
      connection: 'hyper.0tfl77i1uruwft1dgju6m162tu1v',
      children: [],
    });
    expect(ds.tables[0].relationships).toBe(0);
    expect(ds.problems).toEqual([]);
  });

  it('reads a join over a union and a table as one logical table', () => {
    const ds = only(fixture('join-union.xml'));
    expect(ds.tables).toHaveLength(1);
    const join = ds.tables[0].physical!;
    expect(join).toMatchObject({
      type: 'join',
      join: 'inner',
      clauses: [{ operator: '=', left: '[Sheet1+].[Code]', right: '[Sheet12].[alpha-3]' }],
    });
    expect(join.children.map((c) => c.type)).toEqual(['union', 'table']);
    expect(join.children[0]).toMatchObject({ type: 'union', all: 'true', name: 'Sheet1+' });
    expect(join.children[0].children.map((c) => c.name)).toEqual(['Sheet1', 'Sheet11']);
    expect(join.children[1]).toMatchObject({ name: 'Sheet12', table: '[Sheet1$]' });
    expect(ds.problems).toEqual([]);
  });

  describe('constant joins (magnitude__column and correlation__radar-profile excerpts)', () => {
    const xml = fixture('constant-joins.xml');

    it('flags 1 = [X] as constant-join-side and keeps no field pair', () => {
      const ds = named(xml, 'Sample - EU Superstore');
      expect(ds.relationships[0].fields).toEqual([]);
      expect(kinds(ds)).toEqual(['constant-join-side', 'many-to-many']);
      expect(ds.problems[0].message).toContain('1 = [X]');
    });

    it("flags 1 = '1\\r\\n' as no-join-field", () => {
      const ds = named(xml, 'federated.0ekaykw02fhokp0zlnc6r075pqpt');
      expect(ds.relationships[0].fields).toEqual([]);
      expect(kinds(ds)).toEqual(['no-join-field', 'many-to-many']);
    });

    it('never adds tables or leaves from properties context=extract', () => {
      for (const ds of describeDataModel(xml).datasources) {
        expect(ds.tables).toHaveLength(2);
        for (const table of ds.tables) {
          expect(table.physical?.connection).toBeDefined();
          expect(table.physical?.children).toEqual([]);
        }
      }
      expect(kinds(named(xml, 'Sample - EU Superstore'))).not.toContain('duplicate-table');
    });
  });

  describe('hand-built fixtures', () => {
    const xml = fixture('hand-built.xml');

    it('flags a table in no relationship as an orphan', () => {
      const ds = named(xml, 'Orphan');
      expect(ds.problems).toEqual([
        {
          kind: 'orphan-table',
          tables: ['Returns_1'],
          message: 'Returns is in no relationship.',
        },
      ]);
    });

    it('flags an end point that no object declares', () => {
      const ds = named(xml, 'Dangling');
      expect(kinds(ds)).toEqual(['dangling-endpoint']);
      expect(ds.problems[0]).toMatchObject({ tables: ['Returns_Missing'], relationship: 1 });
    });

    it('flags two logical tables with the same caption', () => {
      const ds = named(xml, 'Duplicate Caption');
      expect(ds.problems).toEqual([
        {
          kind: 'duplicate-table',
          tables: ['Orders_1', 'Orders_2'],
          message: '2 logical tables share the caption "Orders".',
        },
      ]);
    });

    it('flags two logical tables reading the same connection and table', () => {
      const ds = only(
        `<workbook><datasources><datasource name='Same Leaf'><object-graph><objects>
          <object caption='A' id='A'><properties context=''><relation connection='c' name='A' table='[T$]' type='table' /></properties></object>
          <object caption='B' id='B'><properties context=''><relation connection='c' name='B' table='[T$]' type='table' /></properties></object>
        </objects><relationships><relationship>
          <expression op='='><expression op='[K]' /><expression op='[K (B)]' /></expression>
          <first-end-point object-id='A' unique-key='false' /><second-end-point object-id='B' unique-key='true' />
        </relationship></relationships></object-graph></datasource></datasources></workbook>`,
      );
      expect(kinds(ds)).toEqual(['duplicate-table']);
      expect(ds.problems[0].tables).toEqual(['A', 'B']);
    });

    it('explicit unique-key=true on the dimension side clears many-to-many', () => {
      const ds = named(xml, 'Explicit Cardinality');
      expect(ds.problems).toEqual([]);
      expect(ds.relationships[0].from).toEqual({
        tableId: 'Orders_1',
        uniqueKey: 'false',
        guaranteedValue: 'true',
        isDbSetUniqueKey: 'false',
        cardinality: 'many',
      });
      expect(ds.relationships[0].to).toEqual({
        tableId: 'People_1',
        uniqueKey: 'true',
        cardinality: 'one',
      });
      expect(facts(ds)).toEqual(FACTS_EXPLICIT);
    });

    it('counts the middle table of a snowflake as in two relationships', () => {
      expect(facts(named(xml, 'Snowflake'))).toEqual(FACTS_SNOWFLAKE);
    });

    it('keeps an unknown unique-key value raw and treats the side as not set', () => {
      const ds = named(xml, 'Unknown Encoding');
      expect(ds.relationships[0].to).toEqual({
        tableId: 'Returns_1',
        uniqueKey: 'yes',
        cardinality: 'not-set',
      });
      expect(kinds(ds)).toEqual(['many-to-many']);
      expect(ds.problems[0].message).toContain('one side set to Many');
      expect(ds.problems[0].message).toContain('not set (Tableau default)');
    });

    it('reads every pair of a multi-field AND relationship (shape from XSD only)', () => {
      const ds = named(xml, 'Multi Field');
      expect(ds.relationships[0].operator).toBe('AND');
      expect(ds.relationships[0].fields).toEqual([
        { operator: '=', fromField: '[Region]', toField: '[Region (Targets)]' },
        { operator: '=', fromField: '[Category]', toField: '[Category (Targets)]' },
      ]);
      expect(ds.problems).toEqual([]);
    });

    it('reads a calculated side as a calc field pair, not a constant (hand-built shape)', () => {
      const ds = named(xml, 'Calculated Side');
      expect(ds.relationships[0].fields).toEqual([
        { operator: '=', fromField: 'LEFT([Code], 3)', toField: '[Code (B)]' },
      ]);
      expect(ds.problems).toEqual([]);
    });

    it('keeps every key of a multi-key physical join (hand-built shape)', () => {
      const ds = named(xml, 'Multi Key Join');
      expect(ds.tables[0].physical!.clauses).toEqual([
        { operator: '=', left: '[A].[k1]', right: '[B].[k1]' },
        { operator: '=', left: '[A].[k2]', right: '[B].[k2]' },
      ]);
    });

    it('flags a relationship with no expression as no-join-field', () => {
      const ds = named(xml, 'Missing Expression');
      expect(kinds(ds)).toEqual(['no-join-field']);
      expect(ds.relationships[0].operator).toBeUndefined();
    });

    it('reports a non-table relation by type only', () => {
      const ds = named(xml, 'Missing Expression');
      expect(ds.tables[1].physical).toEqual({ type: 'text', children: [] });
    });

    it('reads a feature-controlled legacy graph with one object and flags nothing', () => {
      const ds = named(xml, 'Legacy');
      expect(ds.tables.map((t) => [t.id, t.isLegacy])).toEqual([['Orders_1', true]]);
      expect(ds.tables[0].relationships).toBe(0);
      expect(ds.problems).toEqual([]);
    });

    it('reads a datasource with no graph as its single connection relation', () => {
      const ds = named(xml, 'No Graph');
      expect(ds.tables).toHaveLength(1);
      expect(ds.tables[0]).toMatchObject({ id: 'Orders', isLegacy: true });
      expect(ds.tables[0].relationships).toBe(0);
      expect(ds.problems).toEqual([]);
      expect(ds.notes).toHaveLength(1);
    });

    it('reports no tables, with a note, for a graphless collection', () => {
      const ds = named(xml, 'No Graph Collection');
      expect(ds.tables).toEqual([]);
      expect(ds.problems).toEqual([]);
      expect(ds.notes[0]).toContain('tables not read');
    });
  });

  it('skips the Parameters datasource', () => {
    const xml = read(PUBLISHED);
    expect(xml).toContain("name='Parameters'");
    expect(describeDataModel(xml).datasources.map((d) => d.name)).not.toContain('Parameters');
  });

  it('leaves listAvailableFields field count and logical table ids unchanged', () => {
    const fields = listAvailableFields(read(SUPERSTORE));
    expect(fields).toHaveLength(29);
    expect(new Set(fields.map((f) => f.logicalTableId))).toEqual(
      new Set([ORDERS, PEOPLE, RETURNS, undefined]),
    );
    expect(fields.filter((f) => f.logicalTableId === ORDERS)).toHaveLength(18);
    expect(fields.filter((f) => f.logicalTableId === PEOPLE)).toHaveLength(1);
    expect(fields.filter((f) => f.logicalTableId === RETURNS)).toHaveLength(1);
  });
});
