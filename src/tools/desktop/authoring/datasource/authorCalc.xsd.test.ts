import { readFileSync } from 'fs';
import { join } from 'path';
import { validateXML } from 'xmllint-wasm';

import { prepareCalculationsInWorkbook } from './authorCalcCore.js';

const XSD_FIXTURES = join(__dirname, '__fixtures__', 'xsd');

// The TWB schema imports the xml and user namespaces without a schemaLocation.
const TWB_XSD = readFileSync(join(__dirname, '../../../../desktop/data/twb_2026.2.0.xsd'), 'utf8')
  .replace(
    /(<xs:schema\b[^>]*>)/,
    '$1<xs:import namespace="http://www.w3.org/XML/1998/namespace" schemaLocation="xml.xsd"/>',
  )
  .replace(
    '<xs:import namespace="http://www.tableausoftware.com/xml/user"/>',
    '<xs:import namespace="http://www.tableausoftware.com/xml/user" schemaLocation="UserAttributes.xsd"/>',
  );

const PRELOAD = ['xml.xsd', 'UserAttributes.xsd'].map((fileName) => ({
  fileName,
  contents: readFileSync(join(XSD_FIXTURES, fileName), 'utf8'),
}));

function workbookWithDatasourceBody(body: string): string {
  return [
    "<?xml version='1.0' encoding='utf-8' ?>",
    "<workbook source-build='2026.2.0 (20262.26.0804.1806)' source-platform='mac' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>",
    '<datasources>',
    "<datasource caption='Sample' inline='true' name='federated.0abc' version='18.1'>",
    body,
    '</datasource>',
    '</datasources>',
    "<worksheets><worksheet name='Sheet 1'><table>",
    "<view><datasources /><aggregation value='true' /></view><style />",
    "<panes><pane><view><breakdown value='auto' /></view><mark class='Automatic' /></pane></panes>",
    '<rows /><cols />',
    "</table><simple-id uuid='{00000000-0000-0000-0000-000000000001}' /></worksheet></worksheets>",
    "<explain-data enabled-for-viewer='true' extreme-values-enabled-for-all='true'><explanation-types /></explain-data>",
    '</workbook>',
  ].join('\n');
}

const COLUMNS =
  "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />" +
  "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />";

async function schemaErrors(xml: string): Promise<string[]> {
  const result = await validateXML({
    xml: { fileName: 'workbook.twb', contents: xml },
    schema: { fileName: 'twb.xsd', contents: TWB_XSD },
    preload: PRELOAD,
  });
  return result.errors.map((error) => error.rawMessage);
}

describe('prepareCalculationsInWorkbook output against twb_2026.2.0.xsd', () => {
  it.each([
    { label: 'columns only', body: COLUMNS },
    {
      label: 'a layout after the columns',
      body: `${COLUMNS}<layout dim-ordering='alphabetic' measure-ordering='alphabetic' show-structure='true' />`,
    },
    {
      label: 'a column-instance after the columns',
      body: `${COLUMNS}<column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />`,
    },
    {
      label: 'drill paths and semantic values after the columns',
      body: `${COLUMNS}<drill-paths><drill-path name='Money'><field>[Sales]</field><field>[Profit]</field></drill-path></drill-paths><semantic-values><semantic-value key='[Country].[Name]' value='&quot;United States&quot;' /></semantic-values>`,
    },
  ])('stays schema-valid when the datasource has $label', async ({ body }) => {
    const workbookXml = workbookWithDatasourceBody(body);
    expect(await schemaErrors(workbookXml)).toEqual([]);

    const result = prepareCalculationsInWorkbook({
      workbookXml,
      calcs: [
        {
          caption: 'Margin "A" & <B>\'s',
          formula: 'IF [Sales] > 0 AND [Profit] < 10 THEN "a&b" ELSE \'c\' END',
          role: 'dimension',
          datatype: 'string',
        },
        { caption: 'Ratio', formula: 'SUM([Profit]) / SUM([Sales])', defaultFormat: 'p0%' },
      ],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value.authoredCalcs).toHaveLength(2);
    expect(await schemaErrors(result.value.workbookXml)).toEqual([]);
  });
});
