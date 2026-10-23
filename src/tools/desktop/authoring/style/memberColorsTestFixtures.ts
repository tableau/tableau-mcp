// Trimmed from real Desktop payloads (main.26.1012.0832): ds-L3-pre.xml, rb-L3-ds.xml, rb-ds-B1.xml
// and rb-ws-B1.xml from the color probes, and ds-before.xml from the "Set furniture to red" repro.
// Cut: the federated connection's metadata records and ~40 unrelated columns, aliases,
// object-graph, and the Parameters dependencies' range/members. Kept: the shapes that decide
// placement (nested <column> decoys inside <connection> and trailing <datasource-dependencies>,
// layout, semantic-values), the real column/calculation attributes, and the two-copy encoding.

export const STRING_CI =
  "<column-instance column='[Category]' derivation='None' name='[none:Category:nk]' pivot='key' type='nominal' />";
export const BOOL_CI =
  "<column-instance column='[Calculation_B001]' derivation='None' name='[none:Calculation_B001:nk]' pivot='key' type='nominal' />";
export const SET_CI =
  "<column-instance column='[Sub-Category Set]' derivation='InOut' name='[io:Sub-Category Set:nk]' pivot='key' type='nominal' />";
export const ORDINAL_STRING_CI =
  "<column-instance column='[Postal Code]' derivation='None' name='[none:Postal Code:ok]' pivot='key' type='ordinal' />";
export const AGG_CI =
  "<column-instance column='[Calculation_7001]' derivation='User' name='[usr:Calculation_7001:nk]' pivot='key' type='nominal' />";

const SALES_CI =
  "<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />";

type SheetColumn = {
  caption?: string;
  datatype: string;
  name: string;
  role: string;
  calc?: string;
};

export const CATEGORY_COLUMN: SheetColumn = {
  datatype: 'string',
  name: '[Category]',
  role: 'dimension',
};
export const BOOL_COLUMN: SheetColumn = {
  caption: 'Is Tech 1',
  datatype: 'boolean',
  name: '[Calculation_B001]',
  role: 'dimension',
  calc: "<calculation class='tableau' formula='[Category] = &quot;Technology&quot;' />",
};
export const AGG_COLUMN: SheetColumn = {
  caption: 'Plan Status',
  datatype: 'string',
  name: '[Calculation_7001]',
  role: 'measure',
  calc: "<calculation class='tableau' formula='IF SUM([Profit]) &gt; 0 THEN &quot;Favorable&quot; ELSE &quot;Off plan&quot; END' />",
};

function columnXml({ calc, ...attrs }: SheetColumn): string {
  const attributes = Object.entries(attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}='${value}'`)
    .join(' ');
  return calc === undefined
    ? `<column ${attributes} type='nominal' />`
    : `<column ${attributes} type='nominal'>${calc}</column>`;
}

/** One pane per color column; `null` is a pane with no color field. */
export function worksheetXml({
  panes = ['[superstore].[none:Category:nk]'],
  columns = [CATEGORY_COLUMN],
  instances = [STRING_CI],
  tableStyle = '<style />',
  viewStyle = '',
  datasource = 'superstore',
}: {
  panes?: Array<string | null>;
  columns?: SheetColumn[];
  instances?: string[];
  tableStyle?: string;
  viewStyle?: string;
  datasource?: string;
} = {}): string {
  const paneXml = panes
    .map(
      (color) =>
        "<pane selection-relaxation-option='selection-relaxation-allow'><view><breakdown value='auto' /></view><mark class='Automatic' />" +
        (color === null ? '' : `<encodings><color column='${color}' /></encodings>`) +
        '</pane>',
    )
    .join('');
  return [
    "<worksheet name='L1' xmlns:user='http://www.tableausoftware.com/xml/user'>",
    '<table><view>',
    `<datasources><datasource name='${datasource}' /></datasources>`,
    `<datasource-dependencies datasource='${datasource}'>`,
    ...columns.map(columnXml),
    "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />",
    ...instances,
    SALES_CI,
    '</datasource-dependencies>',
    viewStyle,
    "<aggregation value='true' /></view>",
    tableStyle,
    `<panes>${paneXml}</panes>`,
    `<rows>[${datasource}].[sum:Sales:qk]</rows><cols>[${datasource}].[none:Category:nk]</cols>`,
    '</table>',
    "<simple-id uuid='{9ABCE8B5-3E73-4520-AD15-849515E94483}' />",
    '</worksheet>',
  ].join('\n');
}

export const FIELD_CATEGORY = '[none:Category:nk]';

export function encodingXml(field: string, members: Array<[string, string]>): string {
  return (
    `<encoding attr='color' field='${field}' type='palette'>` +
    members.map(([to, bucket]) => `<map to='${to}'><bucket>${bucket}</bucket></map>`).join('') +
    '</encoding>'
  );
}

export function styleXml(...encodings: string[]): string {
  return `<style><style-rule element='mark'>${encodings.join('')}</style-rule></style>`;
}

export function datasourceDoc({
  instances = '',
  columns = '',
  style = '',
  extra = '',
}: {
  instances?: string;
  columns?: string;
  style?: string;
  extra?: string;
} = {}): string {
  return [
    "<datasource inline='true' name='superstore' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>",
    "<connection class='federated'><relation type='collection'>",
    "<relation name='Orders' table='[Orders$]' type='table'><columns header='yes'>",
    "<column datatype='string' name='Category' ordinal='4' />",
    '</columns></relation></relation></connection>',
    "<column datatype='string' name='[Category]' role='dimension' type='nominal' />",
    "<column datatype='real' name='[Profit]' role='measure' type='quantitative' />",
    columns,
    "<column datatype='real' name='[Sales]' role='measure' type='quantitative' />",
    instances,
    extra,
    "<drill-paths><drill-path name='Product'><field>[Category]</field></drill-path></drill-paths>",
    "<layout dim-ordering='alphabetic' measure-ordering='alphabetic' show-structure='true' />",
    style,
    "<semantic-values><semantic-value key='[Country].[Name]' value='&quot;United States&quot;' /></semantic-values>",
    "<datasource-dependencies datasource='Parameters'>",
    "<column caption='Top Customers' datatype='integer' name='[Parameter 1]' param-domain-type='range' role='measure' type='quantitative' value='5' />",
    '</datasource-dependencies>',
    '</datasource>',
  ].join('\n');
}

export const AGG_COLUMN_IN_DATASOURCE = `<column caption='Plan Status' datatype='string' name='[Calculation_7001]' role='measure' type='nominal'>${AGG_COLUMN.calc}</column>`;
export const BOOL_COLUMN_IN_DATASOURCE = `<column caption='Is Tech 1' datatype='boolean' name='[Calculation_B001]' role='dimension' type='nominal'>${BOOL_COLUMN.calc}</column>`;

/** ds-before.xml's color encoding: Desktop's default palette on Category, three members. */
export const DEFAULT_PALETTE_STYLE = styleXml(
  encodingXml(FIELD_CATEGORY, [
    ['#4e79a7', '&quot;Technology&quot;'],
    ['#e15759', '&quot;Office Supplies&quot;'],
    ['#f28e2b', '&quot;Furniture&quot;'],
  ]),
);
