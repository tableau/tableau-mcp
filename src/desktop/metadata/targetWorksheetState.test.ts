import {
  captureTargetWorksheetState,
  compareTargetWorksheetState,
} from './targetWorksheetState.js';

const BASE = `<?xml version='1.0'?><workbook>
  <datasources>
    <datasource name='Superstore'>
      <column name='[Revenue]' role='measure' type='quantitative' datatype='real' semantic-role='[Value].[Name]' />
      <column name='[Unrelated]' role='dimension' type='nominal' datatype='string' />
      <connection class='textscan' />
    </datasource>
    <datasource name='Other'><connection class='excel-direct' /></datasource>
  </datasources>
  <worksheets>
    <worksheet name='Target'><table><rows>[Superstore].[none:Region:nk]</rows></table></worksheet>
    <worksheet name='Sibling'><table><rows /></table></worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='Target'><cards /><viewpoints><viewpoint name='Layout'><zoom value='fit' /><active id='one' /><simple-id uuid='one' /></viewpoint></viewpoints></window>
    <window class='worksheet' name='Sibling' active='true'><cards /></window>
  </windows>
</workbook>`;

const ARTIFACT = `<worksheet name='Preview'><table>
  <view><datasource-dependencies datasource='Superstore'>
    <column-instance name='[sum:Revenue:qk]' column='[Revenue]' derivation='Sum' pivot='key' type='quantitative' />
  </datasource-dependencies></view>
  <cols>[Superstore].[sum:Revenue:qk]</cols>
</table></worksheet>`;

const CALC_AND_GROUP_BASE = BASE.replace(
  "<column name='[Unrelated]'",
  "<column name='[Profit Ratio]' role='measure' type='quantitative' datatype='real'><calculation class='tableau' formula='[Revenue] / 2' /></column>" +
    "<column name='[Revenue Group]' role='dimension' type='nominal' datatype='string'><calculation class='categorical-bin' column='[Revenue]' /></column>" +
    "<column name='[Unrelated]'",
);

const CALC_AND_GROUP_ARTIFACT = `<worksheet name='Preview'><table>
  <view><datasource-dependencies datasource='Superstore'>
    <column-instance name='[usr:Profit Ratio:qk]' column='[Profit Ratio]' derivation='User' pivot='key' type='quantitative' />
    <column-instance name='[none:Revenue Group:nk]' column='[Revenue Group]' derivation='None' pivot='key' type='nominal' />
  </datasource-dependencies></view>
  <rows>[Superstore].[none:Revenue Group:nk]</rows>
  <cols>[Superstore].[usr:Profit Ratio:qk]</cols>
</table></worksheet>`;

describe('target worksheet state', () => {
  it('ignores sibling edits, active navigation, and unrelated datasource changes', () => {
    const expected = captureTargetWorksheetState(BASE, 'Target', ARTIFACT);
    const latest = BASE.replace('<rows />', '<rows>[Other].[none:X:nk]</rows>')
      .replace(" active='true'", " active='false'")
      .replace("class='excel-direct'", "class='hyper'")
      .replace("class='textscan'", "class='hyper'")
      .replace("datatype='string'", "datatype='integer'");

    expect(compareTargetWorksheetState(expected, latest, ARTIFACT)).toEqual({ ok: true });
  });

  it.each([
    [
      'target-worksheet-drift',
      BASE.replace('[Superstore].[none:Region:nk]', '[Superstore].[none:Changed:nk]'),
    ],
    ['target-window-drift', BASE.replace('<cards />', '<cards><edge /></cards>')],
  ])('detects %s without a whole-workbook hash', (code, latest) => {
    const expected = captureTargetWorksheetState(BASE, 'Target', ARTIFACT);
    expect(compareTargetWorksheetState(expected, latest, ARTIFACT)).toEqual({
      ok: false,
      reasons: [code],
    });
  });

  it('detects a new target collision when the target was absent at build time', () => {
    const withoutTarget = BASE.replace(
      /\s*<worksheet name='Target'>[\s\S]*?<\/worksheet>/,
      '',
    ).replace(/\s*<window class='worksheet' name='Target'>[\s\S]*?<\/window>/, '');
    const expected = captureTargetWorksheetState(withoutTarget, 'Target', ARTIFACT);

    expect(compareTargetWorksheetState(expected, BASE, ARTIFACT)).toEqual({
      ok: false,
      reasons: ['target-worksheet-drift', 'target-window-drift'],
    });
  });

  it.each([
    ['role', "role='measure'", "role='dimension'"],
    ['type', "type='quantitative'", "type='nominal'"],
    ['datatype', "datatype='real'", "datatype='integer'"],
    ['semantic role', "semantic-role='[Value].[Name]'", "semantic-role='[Other].[Name]'"],
  ])('detects a referenced field %s change', (_label, before, after) => {
    const expected = captureTargetWorksheetState(BASE, 'Target', ARTIFACT);
    expect(compareTargetWorksheetState(expected, BASE.replace(before, after), ARTIFACT)).toEqual({
      ok: false,
      reasons: ['datasource-drift'],
    });
  });

  it('canonicalizes formatting and attribute order for target/dependency fingerprints', () => {
    const expected = captureTargetWorksheetState(BASE, 'Target', ARTIFACT);
    const reformatted = BASE.replace(
      "name='[Revenue]' role='measure' type='quantitative' datatype='real' semantic-role='[Value].[Name]'",
      "semantic-role='[Value].[Name]' datatype='real' type='quantitative' role='measure' name='[Revenue]'",
    ).replace('<cards />', '\n      <cards />\n      ');

    expect(compareTargetWorksheetState(expected, reformatted, ARTIFACT)).toEqual({ ok: true });
  });

  it('ignores volatile target navigation but retains structural viewpoint content', () => {
    const expected = captureTargetWorksheetState(BASE, 'Target', ARTIFACT);
    const navigationOnly = BASE.replace(
      "<window class='worksheet' name='Target'>",
      "<window class='worksheet' name='Target' active='true' maximized='true'>",
    )
      .replace("<active id='one' />", "<active id='two' />")
      .replace("<simple-id uuid='one' />", "<simple-id uuid='two' />");
    expect(compareTargetWorksheetState(expected, navigationOnly, ARTIFACT)).toEqual({ ok: true });

    expect(
      compareTargetWorksheetState(
        expected,
        BASE.replace("value='fit'", "value='actual'"),
        ARTIFACT,
      ),
    ).toEqual({ ok: false, reasons: ['target-window-drift'] });
  });

  it.each([
    ['calculation change', "formula='[Revenue] / 2'", "formula='[Revenue] / 3'"],
    [
      'group change',
      "class='categorical-bin' column='[Revenue]'",
      "class='categorical-bin' column='[Unrelated]'",
    ],
    ['group removal', /<column name='\[Revenue Group\]'[\s\S]*?<\/column>/, ''],
  ])('detects referenced %s', (_label, before, after) => {
    const expected = captureTargetWorksheetState(
      CALC_AND_GROUP_BASE,
      'Target',
      CALC_AND_GROUP_ARTIFACT,
    );
    expect(
      compareTargetWorksheetState(
        expected,
        CALC_AND_GROUP_BASE.replace(before, after),
        CALC_AND_GROUP_ARTIFACT,
      ),
    ).toEqual({ ok: false, reasons: ['datasource-drift'] });
  });
});
